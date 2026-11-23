//! The main windows and the windows of detached panes, and what the app
//! adjusts in each webview ([`taskbar_icon`], [`pinch`]).
//!
//! Every main window runs a page of its own, with its own project; the first
//! one is labelled `main`, further ones `main-2`, `main-3`, … They share the
//! backend: settings, the TeX distribution and the socket for assistants.
//!
//! A detached editor or PDF preview is a `window.open` popup of a main page:
//! it stays in that page's JavaScript realm, so the pane keeps sharing the
//! editor, the build and all other state with its main window. WebView2
//! refuses `window.open` unless the host supplies the new window, which is
//! why the main windows are built here instead of from `tauri.conf.json`.

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::project::project_key;
use crate::project::watch::ProjectWatch;
use crate::util::i18n::localized;

pub mod context_menu;
pub mod pinch;
pub mod taskbar_icon;

pub const MAIN: &str = "main";

/// What a new main window does first; the page reads it as `window.__GILGAMESH_START__`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum Start {
    /// Opens this project folder, and in it `file` (relative, with `/`) if given.
    Open {
        root: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        file: Option<String>,
    },
    /// Shows the dialog for a new project.
    New,
    /// Shows the dialog for importing this ZIP archive.
    Import { archive: String },
}

/// Which main window was used last and which project each one shows.
#[derive(Default)]
pub struct MainWindows {
    last_focused: Mutex<Option<String>>,
    /// Window label → project folder, compared through `project_key`.
    projects: Mutex<HashMap<String, String>>,
    /// Window label → project folders it made (new, imported, cloned), which it
    /// fills before it claims them or hands them to another window.
    created: Mutex<HashMap<String, HashSet<String>>>,
}

/// Whether `label` is a main window's (and not a detached pane's).
pub fn is_main(label: &str) -> bool {
    label == MAIN || label.strip_prefix("main-").is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

/// The main window a window belongs to: itself, or the owner of a detached pane.
fn owner(label: &str) -> &str {
    label.split_once("-pane-").or_else(|| label.split_once("-detached-")).map_or(label, |(owner, _)| owner)
}

/// Builds the first main window from its entry in `tauri.conf.json` (marked `"create": false`).
/// Without `start` it reopens the last project.
pub fn create_main(app: &AppHandle, start: Option<Start>) -> tauri::Result<()> {
    app.manage(MainWindows::default());
    build_main(app, MAIN, start)
}

/// Opens another main window. A project already shown in a window is not
/// opened twice: that window comes to the front instead (and shows the file).
pub fn open_main(app: &AppHandle, start: Option<Start>) -> Result<(), String> {
    if let Some(Start::Open { root, file }) = &start {
        if let Some(owner) = project_owner(app, root) {
            send_open(app, &owner, root, file.clone(), true);
            return Ok(());
        }
    }
    let label = (2..).map(|n| format!("main-{n}")).find(|label| app.get_webview_window(label).is_none()).unwrap();
    build_main(app, &label, start).map_err(|e| e.to_string())
}

fn build_main(app: &AppHandle, label: &str, start: Option<Start>) -> tauri::Result<()> {
    let mut config = app.config().app.windows.iter().find(|w| w.label == MAIN).cloned().unwrap_or_default();
    config.label = label.to_owned();
    // Shown once it fits on its screen (see `fit_to_screen`), so it does not jump.
    config.visible = false;
    let start = serde_json::to_string(&start).unwrap_or_else(|_| "null".into());
    let handle = app.clone();
    let owner = label.to_owned();
    let window = WebviewWindowBuilder::from_config(app, &config)?
        .initialization_script(format!("window.__GILGAMESH_START__ = {start};"))
        .on_new_window(move |url, features| open_detached(&handle, &owner, &url, features))
        .build()?;
    if let Err(e) = fit_to_screen(&window, &config) {
        eprintln!("window could not be fitted to the screen: {e}");
    }
    window.show()?;
    taskbar_icon::apply(&window);
    pinch::enable(&window);
    context_menu::trim(&window);
    Ok(())
}

/// The configured size (1280×800) is larger than many screens leave free: a
/// 1366×768 laptop, or a larger one scaled to 150 % or more. There the window
/// would reach under the taskbar and hide the status bar, so it is made as large
/// as the work area allows and centred in it; below the minimum size it is maximized.
fn fit_to_screen(window: &tauri::WebviewWindow, config: &tauri::utils::config::WindowConfig) -> tauri::Result<()> {
    let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) else { return Ok(()) };
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let min = ((config.min_width.unwrap_or(0.0) * scale).ceil() as u32, (config.min_height.unwrap_or(0.0) * scale).ceil() as u32);
    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let area = Rect { x: area.position.x, y: area.position.y, width: area.size.width, height: area.size.height };
    match placement(Rect { x: position.x, y: position.y, width: size.width, height: size.height }, min, area) {
        Placement::Keep => {}
        Placement::Maximize => window.maximize()?,
        Placement::Move(r) => {
            window.set_size(tauri::PhysicalSize::new(r.width, r.height))?;
            window.set_position(tauri::PhysicalPosition::new(r.x, r.y))?;
        }
    }
    Ok(())
}

/// A rectangle in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl Rect {
    fn contains(&self, other: &Rect) -> bool {
        let end = |start: i32, length: u32| i64::from(start) + i64::from(length);
        other.x >= self.x
            && other.y >= self.y
            && end(other.x, other.width) <= end(self.x, self.width)
            && end(other.y, other.height) <= end(self.y, self.height)
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Placement {
    /// It lies inside the work area.
    Keep,
    /// Even the minimum size does not fit.
    Maximize,
    Move(Rect),
}

/// Where `window` (with `min` as its smallest size) goes to lie inside the work area `area`.
fn placement(window: Rect, min: (u32, u32), area: Rect) -> Placement {
    if area.contains(&window) {
        return Placement::Keep;
    }
    if min.0 > area.width || min.1 > area.height {
        return Placement::Maximize;
    }
    let (width, height) = (window.width.min(area.width), window.height.min(area.height));
    let centred = |start: i32, free: u32, length: u32| start + ((free - length) / 2) as i32;
    Placement::Move(Rect { x: centred(area.x, area.width, width), y: centred(area.y, area.height, height), width, height })
}

fn focus(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// The file that marks a project's folder (see `project.svelte.ts`).
const PROJECT_FILE: &str = "gilgamesh.json";
/// Asks a main window to open a project and file (see [`OpenRequest`]).
const OPEN_EVENT: &str = "open-request";

/// A project and file the app was asked to open while running, for the window
/// that is to show it; the page opens it, or asks where to (`OpenRequestDialog.svelte`).
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    pub root: String,
    /// Relative to `root`, with `/`.
    pub file: Option<String>,
    /// The window already shows `root`: only the file is opened, nothing asked.
    pub shown: bool,
}

/// What the program was started for: a file named on the command line, as Windows
/// passes it for "Open with Gilgamesh", opened in its project (see [`project_of`]).
pub fn start_from_args(args: &[String], cwd: &Path) -> Option<Start> {
    let file = args.iter().skip(1).filter(|arg| !arg.starts_with("--")).map(|arg| cwd.join(arg)).find(|path| path.is_file())?;
    let (root, file) = project_of(&file)?;
    Some(Start::Open { root: root.to_string_lossy().into_owned(), file: Some(file) })
}

/// The project `file` belongs to and its path in it: the nearest folder above it
/// with a `gilgamesh.json` (`chapters/intro.tex` opens the whole thesis), else its own folder.
pub fn project_of(file: &Path) -> Option<(PathBuf, String)> {
    let folder = file.parent()?;
    let root = folder.ancestors().find(|dir| dir.join(PROJECT_FILE).is_file()).unwrap_or(folder);
    let relative = file.strip_prefix(root).ok()?;
    let relative: Vec<String> = relative.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    Some((root.to_path_buf(), relative.join("/")))
}

/// The program was started again while running (see the single-instance plugin in
/// `lib.rs`). With a file it goes to the window showing its project, else to the
/// window used last, whose page asks whether to open it there or in a new window;
/// without one, a new main window opens, as a second start always did.
pub fn second_start(app: &AppHandle, args: &[String], cwd: &Path) {
    let app = app.clone();
    let start = start_from_args(args, cwd);
    // Building a window on the main thread, where this is called, deadlocks WebView2 (see `window_open_main`).
    tauri::async_runtime::spawn(async move {
        let opened = match start {
            Some(Start::Open { root, file }) => {
                match project_owner(&app, &root).map(|owner| (owner, true)).or_else(|| active_main(&app).map(|label| (label, false))) {
                    Some((label, shown)) => {
                        send_open(&app, &label, &root, file, shown);
                        Ok(())
                    }
                    None => open_main(&app, Some(Start::Open { root, file })),
                }
            }
            _ => open_main(&app, None),
        };
        if let Err(e) = opened {
            eprintln!("second start: {e}");
        }
    });
}

/// Brings the main window `label` to the front and asks its page to open `root` (and `file`).
fn send_open(app: &AppHandle, label: &str, root: &str, file: Option<String>, shown: bool) {
    focus(app, label);
    let _ = app.emit_to(label, OPEN_EVENT, OpenRequest { root: root.to_owned(), file, shown });
}

/// Remembers the window in front, for assistants (see `active_main`).
pub fn focused(app: &AppHandle, label: &str) {
    let owner = owner(label);
    if is_main(owner) {
        *app.state::<MainWindows>().last_focused.lock().unwrap() = Some(owner.to_owned());
    }
}

/// The main window assistants work in: the one used last, or any.
pub fn active_main(app: &AppHandle) -> Option<String> {
    let last = app.state::<MainWindows>().last_focused.lock().unwrap().clone();
    last.filter(|label| app.get_webview_window(label).is_some())
        .or_else(|| app.webview_windows().into_keys().filter(|label| is_main(label)).min())
}

/// The window showing `root`, if any.
fn project_owner(app: &AppHandle, root: &str) -> Option<String> {
    let key = project_key(root);
    let projects = app.state::<MainWindows>().projects.lock().unwrap().clone();
    projects.into_iter().find(|(label, open)| *open == key && app.get_webview_window(label).is_some()).map(|(label, _)| label)
}

/// Records that `label` now shows `root`. If another window already shows it,
/// that window comes to the front and its label is returned; nothing is recorded.
pub fn claim_project(app: &AppHandle, label: &str, root: &str) -> Option<String> {
    if let Some(owner) = project_owner(app, root).filter(|owner| owner != label) {
        focus(app, &owner);
        return Some(owner);
    }
    app.state::<MainWindows>().projects.lock().unwrap().insert(label.to_owned(), project_key(root));
    app.state::<ProjectWatch>().watch(label, root);
    None
}

/// Lets the window `label` work in the project folder `root`, which it has just made.
pub fn grant_created(app: &AppHandle, label: &str, root: &Path) {
    let key = project_key(&root.to_string_lossy());
    app.state::<MainWindows>().created.lock().unwrap().entry(owner(label).to_owned()).or_default().insert(key);
}

/// The project folders the window `label` may work in: the one it shows, and those it made.
fn accessible(app: &AppHandle, label: &str) -> Vec<String> {
    let windows = app.state::<MainWindows>();
    let owner = owner(label);
    let shown = windows.projects.lock().unwrap().get(owner).cloned();
    let created = windows.created.lock().unwrap().get(owner).cloned().unwrap_or_default();
    shown.into_iter().chain(created).collect()
}

/// Whether the window `label` may work in the project folder `root`. The page
/// names the folder of every file call; this keeps a page that runs foreign
/// script (should one ever get in) out of every other folder of the computer.
pub fn check_access(app: &AppHandle, label: &str, root: &Path) -> Result<(), String> {
    let key = project_key(&root.to_string_lossy());
    if accessible(app, label).contains(&key) {
        Ok(())
    } else {
        Err(localized!("error_project_not_open", path = root.display()))
    }
}

/// Whether the absolute `file` lies in a project folder the window `label` may work in.
pub fn check_file_access(app: &AppHandle, label: &str, file: &Path) -> Result<(), String> {
    let inside = |root: &String| project_key(&file.to_string_lossy()).strip_prefix(root.as_str()).is_some_and(|rest| rest.starts_with('/'));
    if file.is_absolute() && !file.components().any(|c| c == Component::ParentDir) && accessible(app, label).iter().any(inside) {
        Ok(())
    } else {
        Err(localized!("error_file_outside_projects", path = file.display()))
    }
}

/// A main window closed: its project is free again and its detached panes go with it.
/// Returns whether other main windows remain.
pub fn main_closed(app: &AppHandle, label: &str) -> bool {
    app.state::<MainWindows>().projects.lock().unwrap().remove(label);
    app.state::<MainWindows>().created.lock().unwrap().remove(label);
    app.state::<ProjectWatch>().unwatch(label);
    let windows = app.webview_windows();
    for (other, window) in &windows {
        if other != label && owner(other) == label {
            let _ = window.destroy();
        }
    }
    windows.keys().any(|other| other != label && is_main(other))
}

/// Supplies the window for a `window.open` call of a main page. The page
/// names the pane in the fragment (`about:blank#editor`), which becomes the
/// label `<main window>-pane-editor`, so it can find the window through the window API.
fn open_detached(app: &AppHandle, owner: &str, url: &tauri::Url, features: NewWindowFeatures) -> NewWindowResponse<tauri::Wry> {
    static NEXT: AtomicUsize = AtomicUsize::new(1);
    let label = url
        .fragment()
        .filter(|pane| !pane.is_empty() && pane.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(|pane| format!("{owner}-pane-{pane}"))
        .filter(|label| app.get_webview_window(label).is_none())
        .unwrap_or_else(|| format!("{owner}-detached-{}", NEXT.fetch_add(1, Ordering::Relaxed)));
    // tao adds to the position before checking it against the monitors: a value near
    // i32::MAX (a drag released somewhere odd) overflows and aborts the app. One that
    // no screen could have is moved to one on none, where Windows picks a place itself.
    let odd_position = features.position().filter(|p| !sane_coordinate(p.x) || !sane_coordinate(p.y));
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::External("about:blank".parse().unwrap())).window_features(features);
    if odd_position.is_some() {
        builder = builder.position(OFF_SCREEN, OFF_SCREEN);
    }
    let window = builder
        .title("Gilgamesh")
        .min_inner_size(320.0, 240.0)
        // As in the main window: dropped files reach the page instead of opening.
        .disable_drag_drop_handler()
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        })
        .build();
    match window {
        Ok(window) => {
            taskbar_icon::apply(&window);
            pinch::enable(&window);
            context_menu::trim(&window);
            NewWindowResponse::Create { window }
        }
        Err(_) => NewWindowResponse::Deny,
    }
}

/// Larger than any arrangement of screens, still far from the limits of window positions.
const MAX_COORDINATE: f64 = 100_000.0;
/// Where a window with an odd position goes: on no screen, so Windows places it.
const OFF_SCREEN: f64 = -MAX_COORDINATE;

fn sane_coordinate(value: f64) -> bool {
    value.is_finite() && value.abs() <= MAX_COORDINATE
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_odd_window_positions() {
        assert!(sane_coordinate(-6.5) && sane_coordinate(3840.0) && sane_coordinate(-1920.0));
        assert!(!sane_coordinate(f64::from(i32::MAX)) && !sane_coordinate(f64::NAN) && !sane_coordinate(f64::INFINITY));
    }

    #[test]
    fn opens_a_file_in_its_project() {
        let dir = crate::util::fs::TestDir::new("open-with");
        let thesis = dir.join("Thesis");
        std::fs::create_dir_all(thesis.join("chapters")).unwrap();
        std::fs::write(thesis.join(PROJECT_FILE), "{}").unwrap();
        std::fs::write(thesis.join("main.tex"), "").unwrap();
        std::fs::write(thesis.join("chapters").join("intro.tex"), "").unwrap();
        std::fs::write(dir.join("loose.tex"), "").unwrap();
        let arg = |path: &Path| path.to_string_lossy().into_owned();
        let open = |root: &Path, file: &str| Some(Start::Open { root: arg(root), file: Some(file.to_owned()) });

        // A file in a subfolder opens the whole project.
        let intro = vec!["gilgamesh.exe".to_owned(), arg(&thesis.join("chapters").join("intro.tex"))];
        assert_eq!(start_from_args(&intro, &dir), open(&thesis, "chapters/intro.tex"));
        // Relative to the folder the program was started in; options are skipped.
        let relative = vec!["gilgamesh.exe".to_owned(), "--flag".to_owned(), "Thesis/main.tex".to_owned()];
        assert_eq!(start_from_args(&relative, &dir), open(&thesis, "main.tex"));
        // Without gilgamesh.json above it, its own folder is the project.
        assert_eq!(start_from_args(&["gilgamesh.exe".to_owned(), arg(&dir.join("loose.tex"))], &dir), open(&dir, "loose.tex"));
        // No file: no start of its own (the last project comes back).
        assert_eq!(start_from_args(&["gilgamesh.exe".to_owned()], &dir), None);
        assert_eq!(start_from_args(&["gilgamesh.exe".to_owned(), arg(&dir.join("missing.tex"))], &dir), None);
        assert_eq!(start_from_args(&["gilgamesh.exe".to_owned(), arg(&thesis)], &dir), None);
    }

    #[test]
    fn fits_new_windows_into_the_work_area() {
        let rect = |x, y, width, height| Rect { x, y, width, height };
        // 1366×768 at 100 %, taskbar 48 px: 1280×800 is too high; it keeps its width, centred.
        let laptop = rect(0, 0, 1366, 720);
        assert_eq!(placement(rect(26, 26, 1280, 800), (800, 500), laptop), Placement::Move(rect(43, 0, 1280, 720)));
        // Fits as it is.
        let large = rect(0, 0, 2560, 1392);
        assert_eq!(placement(rect(100, 80, 1280, 800), (800, 500), large), Placement::Keep);
        // Fits in size, but Windows put it partly off the area: moved inside.
        assert_eq!(placement(rect(1800, 900, 1280, 800), (800, 500), large), Placement::Move(rect(640, 296, 1280, 800)));
        // A second screen left of the first (negative coordinates).
        assert_eq!(placement(rect(-1500, 40, 1280, 800), (800, 500), rect(-1920, 0, 1920, 1040)), Placement::Keep);
        // Smaller than the minimum size: maximized instead.
        assert_eq!(placement(rect(0, 0, 1280, 800), (800, 500), rect(0, 0, 1024, 480)), Placement::Maximize);
    }

    #[test]
    fn tells_main_windows_from_their_panes() {
        assert!(is_main("main") && is_main("main-2") && is_main("main-13"));
        assert!(!is_main("main-pane-editor") && !is_main("main-2-pane-pdf") && !is_main("main-") && !is_main("tab1"));
        assert_eq!(owner("main-pane-editor"), "main");
        assert_eq!(owner("main-2-pane-tab3"), "main-2");
        assert_eq!(owner("main-2-detached-4"), "main-2");
        assert_eq!(owner("main-3"), "main-3");
    }
}
