//! The webview's context menu keeps only what edits text.
//!
//! Outside fields and the editor the page refuses the menu altogether
//! (`refuseContextMenu` in `shortcuts.ts`). In them WebView2 adds "Inspect"
//! and "Writing direction" to cut, copy and paste; both go before it opens.

/// WebView2's names of the items that go (`ICoreWebView2ContextMenuItem::Name`).
#[cfg(windows)]
const REMOVED: [&str; 1] = ["inspectElement"];
/// What WebView2 names an item without a name of its own.
#[cfg(windows)]
const UNNAMED: &str = "other";

/// Takes the items the app has no use for out of `window`'s context menus.
pub fn trim(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        let _ = window.with_webview(|platform| {
            use webview2_com::ContextMenuRequestedEventHandler;
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_11;
            use windows::core::Interface;
            // SAFETY: WebView2 calls, made on the main thread that owns the webview.
            let _ = unsafe {
                (|| -> windows::core::Result<()> {
                    let core = platform.controller().CoreWebView2()?.cast::<ICoreWebView2_11>()?;
                    let handler = ContextMenuRequestedEventHandler::create(Box::new(|_, args| {
                        let Some(args) = args else { return Ok(()) };
                        remove_unused(&args.MenuItems()?)
                    }));
                    let mut token = 0;
                    core.add_ContextMenuRequested(&handler, &mut token)
                })()
            };
        });
    }
    #[cfg(not(windows))]
    let _ = window;
}

/// Drops the `REMOVED` items and "Writing direction", then separators left at either end or next to each other.
#[cfg(windows)]
unsafe fn remove_unused(
    items: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2ContextMenuItemCollection,
) -> windows::core::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows::core::PWSTR;

    let count = |items: &ICoreWebView2ContextMenuItemCollection| -> windows::core::Result<u32> {
        let mut count = 0;
        unsafe { items.Count(&mut count)? };
        Ok(count)
    };
    let separator = |index: u32| -> windows::core::Result<bool> {
        let mut kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND::default();
        unsafe { items.GetValueAtIndex(index)?.Kind(&mut kind)? };
        Ok(kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR)
    };

    let name_of = |item: &ICoreWebView2ContextMenuItem| -> windows::core::Result<String> {
        let mut name = PWSTR::null();
        unsafe { item.Name(&mut name)? };
        Ok(webview2_com::take_pwstr(name))
    };
    let kind_of = |item: &ICoreWebView2ContextMenuItem| -> windows::core::Result<COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND> {
        let mut kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND::default();
        unsafe { item.Kind(&mut kind)? };
        Ok(kind)
    };
    // "Writing direction" has no name ("other") in any language: it is the submenu
    // of unnamed check boxes (default, left to right, right to left).
    let writing_direction = |item: &ICoreWebView2ContextMenuItem| -> windows::core::Result<bool> {
        if name_of(item)? != UNNAMED || kind_of(item)? != COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SUBMENU {
            return Ok(false);
        }
        let children = unsafe { item.Children()? };
        let total = count(&children)?;
        for index in 0..total {
            let child = unsafe { children.GetValueAtIndex(index)? };
            if name_of(&child)? != UNNAMED || kind_of(&child)? != COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_CHECK_BOX {
                return Ok(false);
            }
        }
        Ok(total > 0)
    };

    for index in (0..count(items)?).rev() {
        let item = unsafe { items.GetValueAtIndex(index)? };
        if REMOVED.contains(&name_of(&item)?.as_str()) || writing_direction(&item)? {
            unsafe { items.RemoveValueAtIndex(index)? };
        }
    }
    let mut index = count(items)?;
    while index > 0 {
        index -= 1;
        let last = index + 1 == count(items)?;
        if separator(index)? && (index == 0 || last || separator(index + 1)?) {
            unsafe { items.RemoveValueAtIndex(index)? };
        }
    }
    Ok(())
}
