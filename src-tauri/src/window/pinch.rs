//! Pinching on the touchpad zooms the PDF preview.
//!
//! Tauri turns WebView2's pinch zoom off together with its zoom shortcuts
//! (`zoomHotkeysEnabled`), and WebView2 then drops touchpad pinches before the
//! page sees any of them. With pinch zoom on, a pinch reaches the page as
//! Ctrl + wheel events, by which the PDF preview and the editor zoom; the page
//! keeps the webview from zooming anything itself (see `refuseZoom` in
//! `shortcuts.ts`). The zoom shortcuts stay off.

/// Lets touchpad pinches through to the page of `window`.
pub fn enable(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        let _ = window.with_webview(|platform| {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings5;
            use windows::core::Interface;
            // SAFETY: WebView2 calls, made on the main thread that owns the webview.
            let _ = unsafe {
                (|| -> windows::core::Result<()> {
                    let settings = platform.controller().CoreWebView2()?.Settings()?.cast::<ICoreWebView2Settings5>()?;
                    settings.SetIsPinchZoomEnabled(true)
                })()
            };
        });
    }
    #[cfg(not(windows))]
    let _ = window;
}
