//! Gilgamesh as an MCP server, so AI assistants such as Claude Desktop or
//! Claude Code can read the project, edit in the editor and compile.
//!
//! Those clients start an MCP server as a child process and talk JSON-RPC over
//! its stdin and stdout. Gilgamesh, however, is a window whose state (editor,
//! build, open project) lives in its page. So two parts work together:
//!
//! - [`bridge`]: `gilgamesh --mcp`, started by the client without a window.
//!   It speaks MCP itself and forwards each tool call to the running app.
//! - [`host`]: inside the app, a local socket that takes those calls and hands
//!   them to the page, which runs them like user actions (visible, undoable).
//!
//! They find each other through [`discovery_file`], which also carries a
//! random token: only processes that can read the user's files can connect.

pub mod bridge;
pub mod connect;
pub mod host;
mod tools;

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Must match `identifier` in `tauri.conf.json`: the app writes the discovery
/// file into its config folder, the bridge (without Tauri) has to find it.
pub(crate) const APP_IDENTIFIER: &str = "com.aaron.gilgamesh";

/// Where the running app announces its port and token.
pub fn discovery_file() -> Option<PathBuf> {
    Some(dirs::config_dir()?.join(APP_IDENTIFIER).join("mcp.json"))
}

#[derive(Debug, Serialize, Deserialize)]
struct Discovery {
    port: u16,
    token: String,
}

/// One tool call from the bridge to the app, one line of JSON.
#[derive(Debug, Serialize, Deserialize)]
struct CallRequest {
    token: String,
    name: String,
    #[serde(default)]
    arguments: serde_json::Value,
    /// Sent by the Claude Desktop extension: where it is installed, so Gilgamesh
    /// finds it wherever Claude Desktop keeps its extensions (see `connect`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    extension: Option<ExtensionReport>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ExtensionReport {
    /// The extension's folder (the one holding `manifest.json`).
    folder: PathBuf,
}

/// The page's answer: text for the assistant, and whether the call failed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallResult {
    pub text: String,
    #[serde(default)]
    pub is_error: bool,
}

impl CallResult {
    fn error(text: impl Into<String>) -> Self {
        Self { text: text.into(), is_error: true }
    }
}
