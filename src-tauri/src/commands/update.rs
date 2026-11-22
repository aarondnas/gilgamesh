//! Updates of Gilgamesh itself (see `updates`).

use tauri::{AppHandle, Manager};

use crate::updates::{self, UpdateStatus, Updates};

/// What is known about updates, without asking GitHub.
#[tauri::command]
pub fn update_status(app: AppHandle) -> UpdateStatus {
    app.state::<Updates>().status()
}

/// Asks GitHub for a newer version now ("Check now" in the settings).
#[tauri::command]
pub async fn update_check(app: AppHandle) -> UpdateStatus {
    updates::check(&app).await
}

/// Installs the update found; Gilgamesh ends and starts again. Only returns if it failed.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    updates::install(&app).await
}

/// The calling main window saved its files before the install (`error` if it could not).
#[tauri::command]
pub fn update_saved(window: tauri::Window, app: AppHandle, error: Option<String>) {
    app.state::<Updates>().saved(window.label(), error);
}
