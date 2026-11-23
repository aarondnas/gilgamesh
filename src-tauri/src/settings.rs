//! Installation-wide settings in `settings.json` in the app's config folder
//! (`AppData\Roaming\com.aaron.gilgamesh` on Windows), human-readable and in
//! one place. Per-project settings live in `gilgamesh.json` in the project.

use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::paths::AppPaths;
use crate::util::fs::write_atomic;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// UI language ("de", "en"); `None` follows the system.
    pub locale: Option<String>,
    /// Most recently opened first.
    pub recent_projects: Vec<String>,
    /// Folder the "new project" dialog suggests.
    pub project_location: Option<String>,
    pub auto_install_packages: bool,
    pub sidebar_collapsed: bool,
    /// Text size in the editor; 1 is the normal size.
    pub editor_zoom: f64,
    /// Look for a new version of Gilgamesh once a day (see `updates`).
    pub check_updates: bool,
    /// Which panes are docked, detached or closed, and where their windows were;
    /// only the frontend reads it.
    pub panes: Option<Value>,
    /// Keys written by other versions of the app, kept as they are.
    #[serde(flatten)]
    pub other: Map<String, Value>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            locale: None,
            recent_projects: Vec::new(),
            project_location: None,
            auto_install_packages: false,
            sidebar_collapsed: false,
            editor_zoom: 1.0,
            check_updates: true,
            panes: None,
            other: Map::new(),
        }
    }
}

/// The stored settings, or `None` if there are none yet (first start, or an
/// update from a version that kept them in the webview's storage).
pub async fn load(paths: &AppPaths) -> Option<Settings> {
    let text = tokio::fs::read_to_string(paths.settings_file()).await.ok()?;
    // A damaged file must not lock the user out; start over with defaults.
    Some(serde_json::from_str(&text).unwrap_or_default())
}

/// Writes atomically, so a crash mid-write never leaves half a file.
pub async fn save(paths: &AppPaths, settings: &Settings) -> Result<(), String> {
    let file = paths.settings_file();
    if let Some(dir) = file.parent() {
        tokio::fs::create_dir_all(dir).await.map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    write_atomic(&file, json + "\n").await?;
    *WRITTEN.lock().unwrap() = modified(&file);
    Ok(())
}

/// The measurement system set in Windows' region settings: `"metric"` or `"us"`;
/// `None` where it cannot be read. The page then goes by the language's region.
#[cfg(windows)]
pub fn system_measurement() -> Option<&'static str> {
    use windows_sys::Win32::Globalization::{GetLocaleInfoEx, LOCALE_IMEASURE};
    let mut buffer = [0u16; 4];
    // SAFETY: writes at most `buffer.len()` characters into the buffer, which outlives the call.
    // A null locale name is the user's default locale (LOCALE_NAME_USER_DEFAULT).
    let len = unsafe { GetLocaleInfoEx(std::ptr::null(), LOCALE_IMEASURE, buffer.as_mut_ptr(), buffer.len() as i32) };
    // "0" is metric, "1" the US system.
    (len >= 1).then(|| if buffer[0] == u16::from(b'1') { "us" } else { "metric" })
}

/// The measurement system of the locale on Linux (`LC_MEASUREMENT`, as `locale` reports it):
/// `"metric"` or `"us"`; `None` where it cannot be read. The page then goes by the language's region.
#[cfg(not(windows))]
pub fn system_measurement() -> Option<&'static str> {
    let output = std::process::Command::new("locale").args(["-k", "LC_MEASUREMENT"]).output().ok()?;
    measurement_of(&String::from_utf8_lossy(&output.stdout))
}

/// `measurement=1` is metric, `measurement=2` US customary units.
#[cfg(not(windows))]
fn measurement_of(locale: &str) -> Option<&'static str> {
    match locale.lines().find_map(|line| line.trim().strip_prefix("measurement="))?.trim() {
        "1" => Some("metric"),
        "2" => Some("us"),
        _ => None,
    }
}

/// When the app itself last wrote the file; any other change came from outside.
static WRITTEN: Mutex<Option<SystemTime>> = Mutex::new(None);
const WATCH_INTERVAL: Duration = Duration::from_secs(1);
/// Tells the page to read the settings again.
pub const CHANGED_EVENT: &str = "settings-changed";

fn modified(file: &Path) -> Option<SystemTime> {
    std::fs::metadata(file).and_then(|m| m.modified()).ok()
}

/// Notices when another program (an editor, an AI assistant, …) changes the
/// settings file. The page keeps the settings in memory and writes them back
/// whole, so without this such a change would go unseen and then be overwritten.
pub fn watch(app: AppHandle, paths: &AppPaths) {
    let file = paths.settings_file();
    tauri::async_runtime::spawn(async move {
        let mut seen = modified(&file);
        loop {
            tokio::time::sleep(WATCH_INTERVAL).await;
            let now = modified(&file);
            if now == seen {
                continue;
            }
            seen = now;
            if now.is_some() && now != *WRITTEN.lock().unwrap() {
                changed(&app, None);
            }
        }
    });
}

/// Tells every main window but `except` (the one that wrote them) to read the settings again.
pub fn changed(app: &AppHandle, except: Option<&str>) {
    for label in app.webview_windows().into_keys() {
        if crate::window::is_main(&label) && Some(label.as_str()) != except {
            let _ = app.emit_to(label.as_str(), CHANGED_EVENT, ());
        }
    }
}

#[cfg(test)]
mod tests {
    #[cfg(not(windows))]
    #[test]
    fn reads_the_locales_measurement_system() {
        assert_eq!(super::measurement_of("measurement=1\n"), Some("metric"));
        assert_eq!(super::measurement_of("measurement=2\n"), Some("us"));
        assert_eq!(super::measurement_of(""), None);
    }

    use super::*;
    use crate::util::fs::TestDir;

    #[tokio::test]
    async fn round_trips_and_keeps_unknown_keys() {
        let base = TestDir::new("settings");
        let paths = AppPaths::from_base(base.to_path_buf());

        let missing = load(&paths).await;
        std::fs::create_dir_all(paths.settings_file().parent().unwrap()).unwrap();
        std::fs::write(paths.settings_file(), r#"{"locale":"de","futureOption":42}"#).unwrap();
        let mut settings = load(&paths).await.unwrap();
        settings.recent_projects.push("C:/Thesis".into());
        save(&paths, &settings).await.unwrap();
        let reloaded = load(&paths).await.unwrap();
        std::fs::write(paths.settings_file(), "{ broken").unwrap();
        let damaged = load(&paths).await.unwrap();

        assert!(missing.is_none());
        assert_eq!(reloaded.locale.as_deref(), Some("de"));
        assert_eq!(reloaded.recent_projects, ["C:/Thesis"]);
        assert!(!reloaded.auto_install_packages, "missing keys take their defaults");
        assert_eq!(reloaded.other.get("futureOption"), Some(&Value::from(42)));
        assert_eq!(damaged, Settings::default());
    }
}
