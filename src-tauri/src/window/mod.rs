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
use std::path::{Component, Path};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::project::project_key;
use crate::project::watch::ProjectWatch;
use crate::util::i18n::localized;

pub mod context_menu;
pub mod pinch;
pub mod taskbar_icon;

pub const MAIN: &str = "main";

/// What a new main window does first; the page reads it as `window.__GILGAMESH_START__`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum Start {
    /// Opens this project folder.
    Open { root: String },
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
pub fn create_main(app: &AppHandle) -> tauri::Result<()> {
    app.manage(MainWindows::default());
    build_main(app, MAIN, None)
}

/// Opens another main window. A project already shown in a window is not
/// opened twice: that window comes to the front instead.
pub fn open_main(app: &AppHandle, start: Option<Start>) -> Result<(), String> {
    if let Some(Start::Open { root }) = &start {
        if let Some(owner) = project_owner(app, root) {
            focus(app, &owner);
            return Ok(());
        }
    }
    let label = (2..).map(|n| format!("main-{n}")).find(|label| app.get_webview_window(label).is_none()).unwrap();
    build_main(app, &label, start).map_err(|e| e.to_string())
}

fn build_main(app: &AppHandle, label: &str, start: Option<Start>) -> tauri::Result<()> {
    let mut config = app.config().app.windows.iter().find(|w| w.label == MAIN).cloned().unwrap_or_default();
    config.label = label.to_owned();
    let start = serde_json::to_string(&start).unwrap_or_else(|_| "null".into());
    let handle = app.clone();
    let owner = label.to_owned();
    let window = WebviewWindowBuilder::from_config(app, &config)?
        .initialization_script(format!("window.__GILGAMESH_START__ = {start};"))
        .on_new_window(move |url, features| open_detached(&handle, &owner, &url, features))
        .build()?;
    taskbar_icon::apply(&window);
    pinch::enable(&window);
    context_menu::trim(&window);
    Ok(())
}

fn focus(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
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
    fn tells_main_windows_from_their_panes() {
        assert!(is_main("main") && is_main("main-2") && is_main("main-13"));
        assert!(!is_main("main-pane-editor") && !is_main("main-2-pane-pdf") && !is_main("main-") && !is_main("tab1"));
        assert_eq!(owner("main-pane-editor"), "main");
        assert_eq!(owner("main-2-pane-tab3"), "main-2");
        assert_eq!(owner("main-2-detached-4"), "main-2");
        assert_eq!(owner("main-3"), "main-3");
    }
}
