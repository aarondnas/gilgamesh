//! The installation-wide settings.

use tauri::{Manager, State};

use super::{AppState, CmdResult};
use crate::settings::{self, Settings};

/// `None` before the first save (the frontend then migrates older values).
#[tauri::command]
pub async fn settings_load(state: State<'_, AppState>) -> CmdResult<Option<Settings>> {
    Ok(settings::load(&state.paths).await)
}

#[tauri::command]
pub async fn settings_save(window: tauri::Window, state: State<'_, AppState>, settings: Settings) -> CmdResult<()> {
    settings::save(&state.paths, &settings).await?;
    // The other main windows keep the settings in memory too.
    settings::changed(window.app_handle(), Some(window.label()));
    Ok(())
}

/// The measurement system of the operating system's region settings, for the default unit.
#[tauri::command]
pub fn system_measurement() -> Option<&'static str> {
    settings::system_measurement()
}
