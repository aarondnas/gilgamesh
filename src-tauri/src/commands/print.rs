//! Printing the PDF (see `print`).

use tauri::AppHandle;

use super::{blocking, CmdResult};
use crate::print::{self, Paper, PrintOptions, PrintStatus, Printer};

/// Async on purpose: a synchronous command runs on the main thread, and the system can take
/// a while to list printers (network ones especially), freezing every window meanwhile.
#[tauri::command]
pub async fn print_printers() -> CmdResult<Vec<Printer>> {
    blocking(print::printers).await?
}

/// Opens the system's settings for adding printers (see `print::add_printer`).
#[tauri::command]
pub fn print_add_printer(app: AppHandle) -> CmdResult<()> {
    print::add_printer(&app)
}

/// The paper to lay the sheets out for, if the page has to (see `print::paper`).
/// Synchronous on purpose: GTK is asked, which only works on the main thread.
#[tauri::command]
pub fn print_paper() -> Option<Paper> {
    print::paper()
}

/// Prints the calling page; resolves once the job is spooled.
#[tauri::command]
pub async fn print_page(webview: tauri::Webview, options: PrintOptions) -> CmdResult<PrintStatus> {
    print::print(webview, options).await
}
