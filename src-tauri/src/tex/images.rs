//! Images whose content does not match their name.
//!
//! Pictures saved from a browser are often WebP (or GIF, …) behind a `.jpg`
//! or `.png` name. TeX engines can include only PDF, PNG and JPEG, and given
//! such a file they abort the whole build ("reading JPEG image failed").
//! Before each build every such image is converted into the format its name
//! promises, into a folder of the build directory that TeX searches before the
//! project (see [`texinputs`]). The user's files stay untouched.

use std::collections::HashSet;
use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};

use image::{DynamicImage, ImageFormat, Rgb, RgbImage};

use super::log::{Diagnostic, Severity};
use crate::util::i18n::localized;

/// Folder inside the build directory that holds the converted copies.
const CONVERTED_DIR: &str = ".gilgamesh-images";
/// Projects are small; this only guards against opening e.g. a home folder.
const MAX_FILES: usize = 20_000;
const MAX_DEPTH: usize = 12;
const JPEG_QUALITY: u8 = 92;

/// What a file contains, judged by its first bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Content {
    Jpeg,
    Png,
    Pdf,
    /// Readable by the converter, not by TeX.
    Convertible(ImageFormat),
    /// Neither: HEIC, AVIF, or not an image at all.
    Unreadable(&'static str),
}

fn sniff(head: &[u8]) -> Content {
    let at = |offset: usize, magic: &[u8]| head.get(offset..offset + magic.len()) == Some(magic);
    if at(0, &[0xFF, 0xD8, 0xFF]) {
        Content::Jpeg
    } else if at(0, b"\x89PNG") {
        Content::Png
    } else if head.windows(4).any(|w| w == b"%PDF") {
        Content::Pdf
    } else if at(0, b"RIFF") && at(8, b"WEBP") {
        Content::Convertible(ImageFormat::WebP)
    } else if at(0, b"GIF8") {
        Content::Convertible(ImageFormat::Gif)
    } else if at(0, b"BM") {
        Content::Convertible(ImageFormat::Bmp)
    } else if at(0, b"II*\0") || at(0, b"MM\0*") {
        Content::Convertible(ImageFormat::Tiff)
    } else if at(4, b"ftypavif") || at(4, b"ftypavis") {
        Content::Unreadable("AVIF")
    } else if at(4, b"ftyphei") || at(4, b"ftypmif1") || at(4, b"ftypheic") {
        Content::Unreadable("HEIC")
    } else {
        Content::Unreadable("")
    }
}

fn format_name(format: ImageFormat) -> &'static str {
    match format {
        ImageFormat::WebP => "WebP",
        ImageFormat::Gif => "GIF",
        ImageFormat::Bmp => "BMP",
        ImageFormat::Tiff => "TIFF",
        _ => "other",
    }
}

/// The format a file name promises, for the image types TeX reads.
fn promised(path: &Path) -> Option<ImageFormat> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
        "png" => Some(ImageFormat::Png),
        _ => None,
    }
}

/// The search path for the build: converted images first, then TeX's usual one
/// (the empty entry after the separator stands for it, the project folder included).
pub fn texinputs(out_dir: &Path) -> OsString {
    let separator = if cfg!(windows) { ";" } else { ":" };
    let mut value = out_dir.join(CONVERTED_DIR).into_os_string();
    value.push(separator);
    value
}

/// Converts mismatched images of `project_dir` for the build in `out_dir` and
/// explains each one, so the user can fix the file for good.
pub async fn prepare(project_dir: PathBuf, out_dir: PathBuf) -> Vec<Diagnostic> {
    tokio::task::spawn_blocking(move || prepare_blocking(&project_dir, &out_dir.join(CONVERTED_DIR))).await.unwrap_or_default()
}

fn prepare_blocking(project_dir: &Path, converted_dir: &Path) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    let mut kept = HashSet::new();
    for path in project_images(project_dir) {
        let Some(format) = promised(&path) else { continue };
        let Ok(relative) = path.strip_prefix(project_dir) else { continue };
        let shown = relative.to_string_lossy().replace('\\', "/");
        let content = match read_head(&path) {
            Some(head) => sniff(&head),
            None => continue,
        };
        let expected = if format == ImageFormat::Jpeg { "JPEG" } else { "PNG" };
        match content {
            // The engines recognise PNG and JPEG by their content, whatever the name says.
            Content::Jpeg | Content::Png | Content::Pdf => {}
            Content::Convertible(actual) => {
                let target = converted_dir.join(relative);
                match convert(&path, &target, format) {
                    Ok(()) => {
                        kept.insert(target);
                        diagnostics.push(warning(localized!(
                            "build_image_converted",
                            file = shown,
                            actual = format_name(actual),
                            expected = expected,
                        )));
                    }
                    Err(e) => diagnostics.push(warning(localized!(
                        "build_image_unconvertible",
                        file = shown,
                        actual = format_name(actual),
                        expected = expected,
                        error = e,
                    ))),
                }
            }
            Content::Unreadable("") => diagnostics.push(warning(localized!("build_image_unknown", file = shown, expected = expected))),
            Content::Unreadable(kind) => {
                diagnostics.push(warning(localized!("build_image_unreadable", file = shown, actual = kind, expected = expected)));
            }
        }
    }
    remove_stale(converted_dir, &kept);
    diagnostics
}

fn warning(message: String) -> Diagnostic {
    Diagnostic { severity: Severity::Warning, message, line: None, file: None }
}

fn read_head(path: &Path) -> Option<Vec<u8>> {
    let mut head = vec![0; 1024];
    let mut file = std::fs::File::open(path).ok()?;
    let read = file.read(&mut head).ok()?;
    head.truncate(read);
    Some(head)
}

/// Writes `target` unless it is already newer than `source`.
fn convert(source: &Path, target: &Path, format: ImageFormat) -> Result<(), String> {
    let modified = |path: &Path| std::fs::metadata(path).and_then(|m| m.modified()).ok();
    if let (Some(converted), Some(original)) = (modified(target), modified(source)) {
        if converted >= original {
            return Ok(());
        }
    }
    // By content: the name is exactly what is wrong.
    let image = image::ImageReader::open(source)
        .and_then(|reader| reader.with_guessed_format())
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?;
    let image = match format {
        // JPEG has no transparency; transparent areas become white, as on paper.
        ImageFormat::Jpeg => DynamicImage::ImageRgb8(flatten_on_white(&image)),
        _ => DynamicImage::ImageRgba8(image.to_rgba8()),
    };
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let partial = target.with_extension("part");
    let file = std::fs::File::create(&partial).map_err(|e| e.to_string())?;
    let mut writer = std::io::BufWriter::new(file);
    let written = if format == ImageFormat::Jpeg {
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, JPEG_QUALITY).encode_image(&image)
    } else {
        image.write_to(&mut writer, ImageFormat::Png)
    };
    drop(writer);
    written.map_err(|e| e.to_string())?;
    std::fs::rename(&partial, target).map_err(|e| e.to_string())
}

fn flatten_on_white(image: &DynamicImage) -> RgbImage {
    let rgba = image.to_rgba8();
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, a] = rgba.get_pixel(x, y).0;
        let blend = |c: u8| ((c as u16 * a as u16 + 255 * (255 - a as u16)) / 255) as u8;
        Rgb([blend(r), blend(g), blend(b)])
    })
}

/// `.jpg`, `.jpeg` and `.png` files of the project, hidden folders left out.
fn project_images(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0)];
    let mut seen = 0;
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            seen += 1;
            if seen > MAX_FILES {
                return found;
            }
            let path = entry.path();
            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() && depth < MAX_DEPTH {
                stack.push((path, depth + 1));
            } else if kind.is_file() && promised(&path).is_some() {
                found.push(path);
            }
        }
    }
    found
}

/// Drops copies of images that were fixed, renamed or deleted since.
fn remove_stale(dir: &Path, kept: &HashSet<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if entry.file_type().is_ok_and(|t| t.is_dir()) {
            remove_stale(&path, kept);
            let _ = std::fs::remove_dir(&path);
        } else if !kept.contains(&path) {
            let _ = std::fs::remove_file(&path);
        }
    }
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::util::fs::TestDir;

    #[test]
    fn recognises_formats_by_content() {
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Content::Jpeg);
        assert_eq!(sniff(b"\x89PNG\r\n\x1a\n"), Content::Png);
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Content::Convertible(ImageFormat::WebP));
        assert_eq!(sniff(b"GIF89a"), Content::Convertible(ImageFormat::Gif));
        assert_eq!(sniff(b"\0\0\0\x18ftypheic"), Content::Unreadable("HEIC"));
        assert_eq!(sniff(b"hello"), Content::Unreadable(""));
    }

    #[test]
    fn converts_webp_named_jpg_and_cleans_up_after_a_fix() {
        let dir = TestDir::new("images");
        let project = dir.join("project");
        let out = dir.join("out");
        std::fs::create_dir_all(project.join("bilder")).unwrap();
        let picture = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(4, 3, image::Rgba([200, 30, 30, 128])));
        let webp = project.join("bilder").join("foto.jpg");
        picture.save_with_format(&webp, ImageFormat::WebP).unwrap();

        let diagnostics = prepare_blocking(&project, &out.join(CONVERTED_DIR));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains(r#""message":"build_image_converted""#), "{}", diagnostics[0].message);
        let converted = out.join(CONVERTED_DIR).join("bilder").join("foto.jpg");
        assert_eq!(sniff(&std::fs::read(&converted).unwrap()), Content::Jpeg);

        // Saved as a real JPEG: nothing to convert, the old copy goes away.
        picture.to_rgb8().save_with_format(&webp, ImageFormat::Jpeg).unwrap();
        assert!(prepare_blocking(&project, &out.join(CONVERTED_DIR)).is_empty());
        assert!(!converted.exists());
    }
}
