//! Sharp taskbar icon on Windows.
//!
//! The taskbar draws a window's large icon. Tauri only sets the small one, as a
//! single image at the system's large-icon size, so the taskbar shrinks it by an
//! odd factor (64 → 48 px at 200 %) and blurs it. This sets the large icon at
//! exactly the size the taskbar draws, from `icons/icon.ico` (built from
//! `app-icon.svg`, which holds every size from 16 px up).

/// Every size the taskbar uses (24 px at 100 % up to 300 %), so none is scaled.
#[cfg(windows)]
const TASKBAR_ICO: &[u8] = include_bytes!("../../icons/icon.ico");

/// Sets the large icon of `window` for its current DPI; call again when the DPI changes.
pub fn apply(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CreateIconFromResourceEx, DestroyIcon, SendMessageW, ICON_BIG, LR_DEFAULTCOLOR, WM_SETICON,
        };

        /// Taskbar buttons show 24 px icons at 96 DPI.
        const TASKBAR_ICON_SIZE: u32 = 24;
        /// The icon format version `CreateIconFromResourceEx` expects.
        const ICON_VERSION: u32 = 0x0003_0000;

        let Ok(hwnd) = window.hwnd() else { return };
        let hwnd = hwnd.0;
        // SAFETY: `hwnd` is a live window of this process; the image handed to
        // CreateIconFromResourceEx lies within TASKBAR_ICO; the created icon is
        // owned by us and the one it replaces was set by an earlier call.
        unsafe {
            let dpi = match GetDpiForWindow(hwnd) {
                0 => 96,
                dpi => dpi,
            };
            let size = TASKBAR_ICON_SIZE * dpi / 96;
            let Some(image) = image_for(TASKBAR_ICO, size) else { return };
            let icon =
                CreateIconFromResourceEx(image.as_ptr(), image.len() as u32, 1, ICON_VERSION, size as i32, size as i32, LR_DEFAULTCOLOR);
            if icon.is_null() {
                return;
            }
            let previous = SendMessageW(hwnd, WM_SETICON, ICON_BIG as usize, icon as isize);
            if previous != 0 {
                DestroyIcon(previous as _);
            }
        }
    }
    #[cfg(not(windows))]
    let _ = window;
}

/// The image of an `.ico` file closest to `size`: the smallest at least that
/// large (shrunk if need be, which stays sharp), else the largest there is.
#[cfg(windows)]
fn image_for(ico: &[u8], size: u32) -> Option<&[u8]> {
    let u16_at = |at: usize| Some(u16::from_le_bytes(ico.get(at..at + 2)?.try_into().ok()?));
    let u32_at = |at: usize| Some(u32::from_le_bytes(ico.get(at..at + 4)?.try_into().ok()?));
    let count = u16_at(4)? as usize;
    let mut images = Vec::with_capacity(count);
    for i in 0..count {
        let entry = 6 + 16 * i;
        // 0 stands for 256.
        let width = match *ico.get(entry)? {
            0 => 256,
            w => w as u32,
        };
        let (len, offset) = (u32_at(entry + 8)? as usize, u32_at(entry + 12)? as usize);
        images.push((width, ico.get(offset..offset + len)?));
    }
    images.sort_by_key(|(width, _)| *width);
    images.iter().find(|(width, _)| *width >= size).or(images.last()).map(|(_, image)| *image)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn picks_the_exact_size_or_the_next_larger_one() {
        let at = |size| image_for(TASKBAR_ICO, size).map(|image| image.as_ptr());
        let image_of = |size| image_for(TASKBAR_ICO, size).unwrap();
        // Every taskbar size from 100 % to 300 % is in the file.
        for size in [24, 30, 36, 48, 60, 72] {
            assert!(image_of(size).starts_with(b"\x89PNG"), "{size}");
        }
        assert_eq!(at(25), at(30));
        assert_eq!(at(1000), at(256));
    }
}
