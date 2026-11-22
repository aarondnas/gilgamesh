//! The app's end: a socket on 127.0.0.1 that takes tool calls from the bridge
//! and hands them to the page. One call per connection, one line each way.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

use super::{discovery_file, CallRequest, CallResult, Discovery};

/// Longer than a build may take (see `tex::compile`).
const CALL_TIMEOUT: Duration = Duration::from_secs(330);
/// A whole file may come along with `write_file`.
const MAX_REQUEST: u64 = 32 * 1024 * 1024;
const EVENT: &str = "mcp-call";
/// Not a tool: asks for the current tool list (see `bridge.js`).
const LIST_TOOLS: &str = "__tools__";

#[derive(Default)]
pub struct McpHost {
    token: String,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<CallResult>>>,
}

#[derive(Clone, Serialize)]
struct CallEvent {
    id: u64,
    name: String,
    arguments: serde_json::Value,
}

impl McpHost {
    /// Listens on a free port and announces it in the discovery file.
    pub fn start(app: &AppHandle) -> Result<(), String> {
        let mut bytes = [0u8; 24];
        getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
        let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        app.manage(McpHost { token: token.clone(), ..Default::default() });

        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let file = discovery_file().ok_or("No config directory for the discovery file")?;
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(&Discovery { port, token }).map_err(|e| e.to_string())?;
        std::fs::write(&file, json).map_err(|e| e.to_string())?;

        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let Ok(listener) = TcpListener::from_std(listener) else { return };
            while let Ok((stream, _)) = listener.accept().await {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = serve(&app, stream).await;
                });
            }
        });
        Ok(())
    }

    /// The page's answer to call `id`.
    pub fn respond(&self, id: u64, result: CallResult) {
        if let Some(sender) = self.pending.lock().unwrap().remove(&id) {
            let _ = sender.send(result);
        }
    }
}

async fn serve(app: &AppHandle, stream: TcpStream) -> std::io::Result<()> {
    let (read, mut write) = stream.into_split();
    let mut line = String::new();
    BufReader::new(read.take(MAX_REQUEST)).read_line(&mut line).await?;
    let result = handle(app, &line).await;
    let mut answer = serde_json::to_string(&result).unwrap_or_default();
    answer.push('\n');
    write.write_all(answer.as_bytes()).await
}

async fn handle(app: &AppHandle, line: &str) -> CallResult {
    // Anything else (a browser's HTTP request, for instance) is not JSON and fails here.
    let Ok(request) = serde_json::from_str::<CallRequest>(line) else {
        return CallResult::error("Invalid request");
    };
    let host = app.state::<McpHost>();
    if !constant_time_eq(request.token.as_bytes(), host.token.as_bytes()) {
        return CallResult::error("Invalid token");
    }
    if let Some(extension) = &request.extension {
        super::connect::remember_extension(&extension.folder);
    }
    // For bridges that ship a copy of the list (the Claude Desktop extension):
    // they ask the running app, so tools added later need no new extension.
    if request.name == LIST_TOOLS {
        return CallResult { text: super::tools::list().to_string(), is_error: false };
    }
    let id = host.next_id.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = oneshot::channel();
    host.pending.lock().unwrap().insert(id, sender);
    let event = CallEvent { id, name: request.name, arguments: request.arguments };
    // Assistants work in the main window used last; each window has its own project.
    let Some(target) = crate::window::active_main(app) else {
        host.pending.lock().unwrap().remove(&id);
        return CallResult::error("Gilgamesh has no open window.");
    };
    if app.emit_to(target.as_str(), EVENT, event).is_err() {
        host.pending.lock().unwrap().remove(&id);
        return CallResult::error("Gilgamesh could not pass the request on.");
    }
    match tokio::time::timeout(CALL_TIMEOUT, receiver).await {
        Ok(Ok(result)) => result,
        _ => {
            host.pending.lock().unwrap().remove(&id);
            CallResult::error("Gilgamesh did not answer in time.")
        }
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}
