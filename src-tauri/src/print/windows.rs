//! Printing on Windows: the printers Windows knows, and WebView2 printing the page.

use super::{Duplex, PrintOptions, PrintStatus, Printer};

/// Windows' "Printers & scanners", which also searches the network.
pub const PRINTER_SETTINGS: &str = "ms-settings:printers";

pub fn printers() -> Result<Vec<Printer>, String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Graphics::Printing::{
        EnumPrintersW, GetDefaultPrinterW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_4W,
    };

    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let (mut needed, mut count) = (0u32, 0u32);
    // SAFETY: the first call only asks for the buffer size; the second fills a
    // buffer of that size, aligned for PRINTER_INFO_4W (u64 words).
    let infos = unsafe {
        EnumPrintersW(flags, null(), 4, null_mut(), 0, &mut needed, &mut count);
        if needed == 0 {
            return Ok(Vec::new());
        }
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
        if EnumPrintersW(flags, null(), 4, buffer.as_mut_ptr().cast(), needed, &mut needed, &mut count) == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let infos = std::slice::from_raw_parts(buffer.as_ptr().cast::<PRINTER_INFO_4W>(), count as usize);
        infos.iter().map(|info| wide_to_string(info.pPrinterName)).collect::<Vec<_>>()
    };

    let mut size = 0u32;
    // SAFETY: as above, size first, then a buffer of that many UTF-16 units.
    let default = unsafe {
        GetDefaultPrinterW(null_mut(), &mut size);
        let mut name = vec![0u16; size as usize];
        if size > 0 && GetDefaultPrinterW(name.as_mut_ptr(), &mut size) != 0 {
            wide_to_string(name.as_ptr())
        } else {
            String::new()
        }
    };

    Ok(infos.into_iter().map(|name| Printer { is_default: name == default, name }).collect())
}

/// Reads a NUL-terminated UTF-16 string.
unsafe fn wide_to_string(ptr: *const u16) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let mut len = 0;
    // SAFETY: the caller passes a NUL-terminated string.
    unsafe {
        while *ptr.add(len) != 0 {
            len += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
    }
}

/// Prints the calling page as it looks under `@media print`.
pub async fn print(webview: tauri::Webview, options: PrintOptions) -> Result<PrintStatus, String> {
    use std::sync::{Arc, Mutex};
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::PrintCompletedHandler;
    use windows::core::{Interface, HSTRING};

    type Reply = Arc<Mutex<Option<tokio::sync::oneshot::Sender<Result<PrintStatus, String>>>>>;
    /// Answered by the completion handler, or right away if the job could not start.
    fn answer(tx: &Reply, result: Result<PrintStatus, String>) {
        if let Some(tx) = tx.lock().ok().and_then(|mut tx| tx.take()) {
            let _ = tx.send(result);
        }
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx: Reply = Arc::new(Mutex::new(Some(tx)));

    webview
        .with_webview(move |platform| {
            let handler_tx = tx.clone();
            // SAFETY: WebView2 calls, made on the main thread that owns the webview.
            let started = unsafe {
                (|| -> windows::core::Result<()> {
                    let core = platform.controller().CoreWebView2()?.cast::<ICoreWebView2_16>()?;
                    let settings = platform.environment().cast::<ICoreWebView2Environment6>()?.CreatePrintSettings()?;
                    settings.SetOrientation(if options.landscape {
                        COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
                    } else {
                        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
                    })?;
                    // The page images bring the PDF's own margins.
                    settings.SetMarginTop(0.0)?;
                    settings.SetMarginBottom(0.0)?;
                    settings.SetMarginLeft(0.0)?;
                    settings.SetMarginRight(0.0)?;
                    settings.SetShouldPrintHeaderAndFooter(false)?;
                    settings.SetShouldPrintBackgrounds(true)?;

                    let more = settings.cast::<ICoreWebView2PrintSettings2>()?;
                    if let Some(name) = &options.printer {
                        more.SetPrinterName(&HSTRING::from(name.as_str()))?;
                    }
                    more.SetCopies(options.copies.max(1))?;
                    more.SetCollation(if options.collate {
                        COREWEBVIEW2_PRINT_COLLATION_COLLATED
                    } else {
                        COREWEBVIEW2_PRINT_COLLATION_UNCOLLATED
                    })?;
                    more.SetDuplex(match options.duplex {
                        Duplex::OneSided => COREWEBVIEW2_PRINT_DUPLEX_ONE_SIDED,
                        Duplex::LongEdge => COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_LONG_EDGE,
                        Duplex::ShortEdge => COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_SHORT_EDGE,
                    })?;
                    more.SetColorMode(if options.grayscale {
                        COREWEBVIEW2_PRINT_COLOR_MODE_GRAYSCALE
                    } else {
                        COREWEBVIEW2_PRINT_COLOR_MODE_COLOR
                    })?;

                    let handler = PrintCompletedHandler::create(Box::new(move |result, status| {
                        let status = match (result, status) {
                            (Ok(()), COREWEBVIEW2_PRINT_STATUS_SUCCEEDED) => Ok(PrintStatus::Succeeded),
                            (Ok(()), COREWEBVIEW2_PRINT_STATUS_PRINTER_UNAVAILABLE) => Ok(PrintStatus::PrinterUnavailable),
                            (Ok(()), _) => Ok(PrintStatus::Failed),
                            (Err(err), _) => Err(err.message()),
                        };
                        answer(&handler_tx, status);
                        Ok(())
                    }));
                    core.Print(&settings, &handler)
                })()
            };
            if let Err(err) = started {
                answer(&tx, Err(err.message()));
            }
        })
        .map_err(|err| err.to_string())?;

    rx.await.map_err(|_| "print job lost".to_string())?
}
