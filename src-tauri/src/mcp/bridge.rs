//! `gilgamesh --mcp`: the MCP server the assistant starts. Speaks JSON-RPC over
//! stdin and stdout (one message per line), answers the protocol itself and
//! forwards tool calls to the running app. Logging goes to stderr only: stdout
//! belongs to the protocol.

use std::sync::Arc;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::Mutex;

use super::{discovery_file, tools, CallRequest, CallResult, Discovery};

/// Newest first; an older client gets the version it asked for if listed.
const PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

/// Runs until the client closes stdin. Returns the process exit code.
pub fn run() -> i32 {
    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(e) => {
            eprintln!("gilgamesh --mcp: {e}");
            return 1;
        }
    };
    runtime.block_on(serve());
    0
}

async fn serve() {
    let stdout = Arc::new(Mutex::new(tokio::io::stdout()));
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut running = tokio::task::JoinSet::new();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            send(&stdout, error_response(Value::Null, -32700, "Parse error")).await;
            continue;
        };
        // Calls run concurrently: a long build must not hold up other requests.
        let stdout = stdout.clone();
        running.spawn(async move {
            if let Some(response) = respond(message).await {
                send(&stdout, response).await;
            }
        });
    }
    // The client closed its end: finish what it already asked for.
    while running.join_next().await.is_some() {}
}

/// The answer to one message; `None` for notifications, which get none.
async fn respond(message: Value) -> Option<Value> {
    let id = message.get("id").cloned()?;
    let method = message.get("method").and_then(Value::as_str).unwrap_or_default();
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let result = match method {
        "initialize" => {
            let requested = params.get("protocolVersion").and_then(Value::as_str);
            let version = requested.filter(|v| PROTOCOL_VERSIONS.contains(v)).unwrap_or(PROTOCOL_VERSIONS[0]);
            json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "gilgamesh", "title": "Gilgamesh", "version": env!("CARGO_PKG_VERSION") },
                "instructions": tools::INSTRUCTIONS,
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools::list() }),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or_default().to_owned();
            let arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            let result = call_app(name, arguments).await;
            json!({
                "content": [{ "type": "text", "text": result.text }],
                "isError": result.is_error,
            })
        }
        _ => return Some(error_response(id, -32601, &format!("Method not found: {method}"))),
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

/// Forwards a tool call to the running app. Read anew each time, so the app
/// may be started (or restarted) while the assistant is already connected.
async fn call_app(name: String, arguments: Value) -> CallResult {
    let not_running = "Gilgamesh is not running: start it and open a project, then try again.";
    let Some(discovery) =
        discovery_file().and_then(|file| std::fs::read_to_string(file).ok()).and_then(|text| serde_json::from_str::<Discovery>(&text).ok())
    else {
        return CallResult::error(not_running);
    };
    let Ok(stream) = TcpStream::connect(("127.0.0.1", discovery.port)).await else {
        return CallResult::error(not_running);
    };
    let (read, mut write) = stream.into_split();
    let request = CallRequest { token: discovery.token, name, arguments, extension: None };
    let mut line = serde_json::to_string(&request).unwrap_or_default();
    line.push('\n');
    if write.write_all(line.as_bytes()).await.is_err() {
        return CallResult::error(not_running);
    }
    let mut answer = String::new();
    match BufReader::new(read).read_line(&mut answer).await {
        Ok(n) if n > 0 => serde_json::from_str(&answer).unwrap_or_else(|_| CallResult::error("Invalid answer from Gilgamesh")),
        _ => CallResult::error("Gilgamesh closed the connection."),
    }
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

async fn send(stdout: &Mutex<tokio::io::Stdout>, message: Value) {
    let mut line = message.to_string();
    line.push('\n');
    let mut out = stdout.lock().await;
    let _ = out.write_all(line.as_bytes()).await;
    let _ = out.flush().await;
}
