//! The main windows (see `window`).

use tauri::{AppHandle, Manager};

use super::CmdResult;
use crate::window::{self, Start};

/// Opens another main window, e.g. to work on a second project at the same time.
/// Async on purpose: a synchronous command runs on the main thread, and building
/// a window there deadlocks WebView2, leaving a white window that never loads.
#[tauri::command]
pub async fn window_open_main(app: AppHandle, start: Option<Start>) -> CmdResult<()> {
    window::open_main(&app, start)
}

/// Before a window opens a project: `None` if it may, otherwise the window
/// that already shows it, which is brought to the front.
#[tauri::command]
pub fn project_claim(window: tauri::Window, root: String) -> Option<String> {
    window::claim_project(window.app_handle(), window.label(), &root)
}
