//! Printing the PDF: the page lays the PDF's pages out for print (one sheet
//! per printed page, several PDF pages on it if chosen; see `print.ts`), and the
//! system's webview sends that page to the printer with the options chosen on the
//! "Print" page, without a dialog of its own: WebView2 on Windows (`windows`),
//! WebKitGTK on Linux (`linux`). The printers are those the system knows; its own
//! settings add more, network printers included (`add_printer`).

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(windows)]
mod windows;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Printer {
    pub(crate) name: String,
    pub(crate) is_default: bool,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Duplex {
    OneSided,
    LongEdge,
    ShortEdge,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintOptions {
    /// `None` prints on the default printer.
    pub(crate) printer: Option<String>,
    pub(crate) copies: i32,
    pub(crate) collate: bool,
    pub(crate) duplex: Duplex,
    pub(crate) grayscale: bool,
    /// The page lays out its sheets itself, several PDF pages to one included.
    pub(crate) landscape: bool,
}

/// The paper the page lays its sheets out for, in millimetres, upright.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Paper {
    pub(crate) width: f64,
    pub(crate) height: f64,
}

/// How a print job ended; the page words it in the user's language.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PrintStatus {
    Succeeded,
    PrinterUnavailable,
    Failed,
}

/// The printers the system knows, the default one marked.
pub fn printers() -> Result<Vec<Printer>, String> {
    #[cfg(windows)]
    return windows::printers();
    #[cfg(target_os = "linux")]
    return Ok(linux::printers());
}

/// The paper the page has to size its sheets for itself: WebKitGTK resolves `vw` and
/// `vh` to the window even when printing. `None` where the viewport is the printed
/// page (WebView2), so the sheets fill it whatever the paper. Call on the main thread.
pub fn paper() -> Option<Paper> {
    #[cfg(windows)]
    return None;
    #[cfg(target_os = "linux")]
    return Some(linux::paper());
}

/// Prints the calling page as it looks under `@media print`; resolves once the job is spooled.
pub async fn print(webview: tauri::Webview, options: PrintOptions) -> Result<PrintStatus, String> {
    #[cfg(windows)]
    return windows::print(webview, options).await;
    #[cfg(target_os = "linux")]
    return linux::print(webview, options).await;
}

/// Opens the system's own settings for adding printers, which also search the network.
pub fn add_printer(app: &AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use tauri_plugin_opener::OpenerExt;
        app.opener().open_url(windows::PRINTER_SETTINGS, None::<&str>).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "linux")]
    return linux::add_printer(app);
}
