//! The program: the app, or with `--mcp` the MCP server an AI assistant
//! starts (see `mcp::bridge`).

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Started by an AI assistant as its MCP server: no window, protocol on stdio.
    if std::env::args().any(|arg| arg == "--mcp") {
        std::process::exit(gilgamesh_lib::mcp::bridge::run());
    }
    // Claude Code hook entered by a development version; it must not open a window on every tool call.
    if std::env::args().any(|arg| arg == "--hook") {
        std::process::exit(0);
    }
    gilgamesh_lib::run()
}
