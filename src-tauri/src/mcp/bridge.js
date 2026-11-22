// Gilgamesh's MCP server inside the Claude Desktop extension (see `connect.rs`).
// The same protocol as `bridge.rs`, in JavaScript, because Claude Desktop runs
// it with its built-in Node.js: the extension then starts no Gilgamesh program,
// which therefore stays free to be updated or rebuilt, and keeps working after
// Gilgamesh moved. Keep both bridges in step.
//
// Speaks JSON-RPC over stdin/stdout (one message per line) and forwards tool
// calls to the running app over 127.0.0.1, found through its discovery file.
"use strict";
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const readline = require("readline");

// Filled in by Gilgamesh when it writes the extension.
const TOOLS = __TOOLS__;
const INSTRUCTIONS = __INSTRUCTIONS__;
const VERSION = __VERSION__;
const APP_IDENTIFIER = __APP_IDENTIFIER__;
// Changes whenever this script or its instructions do; tells Gilgamesh whether this
// installed copy is current. Gilgamesh reads it from the line as written here.
const REVISION = __REVISION__;

// Where Claude Desktop installed this extension, which may move between its
// versions: sent along with every call, so Gilgamesh learns it (see `connect.rs`).
const EXTENSION = { folder: path.resolve(__dirname, "..") };

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const NOT_RUNNING = "Gilgamesh is not running: start it and open a project, then try again.";

/** Where the running app announces port and token; the same folder as Tauri's app config dir. */
function discoveryFile() {
  const home = os.homedir();
  const base =
    process.platform === "win32"
      ? process.env.APPDATA || path.join(home, "AppData", "Roaming")
      : process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(base, APP_IDENTIFIER, "mcp.json");
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

/** Forwards one tool call; read anew each time, so Gilgamesh may start after Claude. */
function callApp(name, args) {
  return new Promise((resolve) => {
    let discovery;
    try {
      discovery = JSON.parse(fs.readFileSync(discoveryFile(), "utf8"));
    } catch {
      return resolve({ text: NOT_RUNNING, isError: true });
    }
    const socket = net.createConnection({ host: "127.0.0.1", port: discovery.port });
    let answer = "";
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(JSON.stringify({ token: discovery.token, name, arguments: args, extension: EXTENSION }) + "\n");
    });
    socket.on("data", (chunk) => {
      answer += chunk;
      const end = answer.indexOf("\n");
      if (end < 0) return;
      try {
        finish(JSON.parse(answer.slice(0, end)));
      } catch {
        finish({ text: "Invalid answer from Gilgamesh", isError: true });
      }
    });
    socket.on("error", () => finish({ text: NOT_RUNNING, isError: true }));
    socket.on("close", () => finish({ text: "Gilgamesh closed the connection.", isError: true }));
  });
}

/** The answer to one message; `null` for notifications, which get none. */
async function respond(message) {
  if (message.id === undefined || message.id === null) return null;
  const { id, method, params = {} } = message;
  switch (method) {
    case "initialize": {
      const version = PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "gilgamesh", title: "Gilgamesh", version: VERSION },
          instructions: INSTRUCTIONS,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list": {
      // The running app's list, so tools added in later versions work without
      // installing the extension again; the built-in copy while it is closed.
      const live = await callApp("__tools__", {});
      let tools = TOOLS;
      if (!live.isError) {
        try {
          tools = JSON.parse(live.text);
        } catch {
          // Keep the built-in list.
        }
      }
      return { jsonrpc: "2.0", id, result: { tools } };
    }
    case "tools/call": {
      const result = await callApp(params.name || "", params.arguments || {});
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: result.text }], isError: Boolean(result.isError) },
      };
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  // Calls run concurrently: a long build must not hold up other requests.
  respond(message).then((response) => response && send(response));
});
