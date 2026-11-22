//! Printing the PDF (see `print`).

use super::{blocking, CmdResult};
use crate::print::{self, PrintOptions, PrintStatus, Printer};

/// Async on purpose: a synchronous command runs on the main thread, and Windows can take
/// a while to list printers (network ones especially), freezing every window meanwhile.
#[tauri::command]
pub async fn print_printers() -> CmdResult<Vec<Printer>> {
    blocking(print::printers).await?
}

/// Prints the calling page; resolves once the job is spooled.
#[tauri::command]
pub async fn print_page(webview: tauri::Webview, options: PrintOptions) -> CmdResult<PrintStatus> {
    print::print(webview, options).await
}
