//! AI assistants working with Gilgamesh over MCP (see `mcp`).

use tauri::{AppHandle, Manager, State};

use super::{blocking, AppState, CmdResult};
use crate::mcp::connect::{self, AssistantStatus, DesktopConnection};
use crate::mcp::host::McpHost;
use crate::mcp::CallResult;

/// The page's answer to a tool call from an AI assistant.
#[tauri::command]
pub fn mcp_respond(app: AppHandle, id: u64, result: CallResult) {
    if let Some(host) = app.try_state::<McpHost>() {
        host.respond(id, result);
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantsStatus {
    /// Whether the app accepts tool calls.
    running: bool,
    desktop: AssistantStatus,
    code: AssistantStatus,
    codex: AssistantStatus,
}

/// For the settings page: which assistants are installed and connected. Off the main
/// thread: it searches folders and may refresh the launcher copy of this program.
#[tauri::command]
pub async fn assistant_status(app: AppHandle) -> CmdResult<AssistantsStatus> {
    let running = app.try_state::<McpHost>().is_some();
    blocking(move || AssistantsStatus {
        running,
        desktop: connect::desktop_status(),
        code: connect::code_status(),
        codex: connect::codex_status(),
    })
    .await
}

#[tauri::command]
pub fn assistant_connect_desktop(app: AppHandle, state: State<'_, AppState>) -> CmdResult<DesktopConnection> {
    connect::connect_desktop(&app, &state.paths.scratch())
}

#[tauri::command]
pub async fn assistant_connect_code() -> CmdResult<()> {
    connect::connect_code().await
}

#[tauri::command]
pub fn assistant_connect_codex() -> CmdResult<()> {
    connect::connect_codex()
}
