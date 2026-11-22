//! The font manager: every font family the repository has as OpenType or
//! TrueType, read from tlmgr's copy of its database (see `index`), and their
//! files for the preview. A package not installed yet is shown from its
//! archive: downloaded once, checked against the database's checksum, and only
//! its font files kept, under `tex/font-previews`.

use std::collections::{BTreeMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha512};

use super::index::IndexCache;
use crate::paths::AppPaths;
use crate::util::i18n::localized;

/// Where tlmgr installs from when the installation names no repository of its own.
const DEFAULT_REPOSITORY: &str = "https://mirror.ctan.org/systems/texlive/tlnet";

/// A package of the repository with fonts in it, as its database entry has it.
#[derive(Debug, Clone, Default)]
pub struct FontPackage {
    pub name: String,
    pub description: String,
    pub license: String,
    pub topics: Vec<String>,
    /// The archive's size in bytes and its SHA-512 (lowercase hex).
    pub size: u64,
    pub checksum: String,
    /// OpenType and TrueType files, relative to `texmf-dist` (`fonts/opentype/public/…`).
    pub faces: Vec<String>,
    /// Its LaTeX packages (`ebgaramond`), by which pdfLaTeX loads its fonts.
    pub styles: Vec<String>,
    /// Whether it has Type 1 fonts, which pdfLaTeX needs.
    pub type1: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FontKind {
    Serif,
    Sans,
    Mono,
    Math,
    Other,
}

/// A font family as the font manager offers it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFamily {
    /// `package/Stem`, unique.
    pub id: String,
    pub package: String,
    pub name: String,
    pub kind: FontKind,
    /// Its faces, relative to `texmf-dist`; the regular one always.
    pub regular: String,
    pub italic: Option<String>,
    pub bold: Option<String>,
    pub bold_italic: Option<String>,
    /// How many faces it has in all (weights, widths, initials …).
    pub faces: usize,
    /// The LaTeX package that sets it under pdfLaTeX; `None` where only XeLaTeX and LuaLaTeX can use it.
    pub sty: Option<String>,
    pub description: String,
    pub license: String,
    /// The download size of its package in bytes.
    pub size: u64,
    pub installed: bool,
}

/// The packages with OpenType or TrueType fonts in `tlpdb` (tlmgr's database format).
pub fn parse_packages(tlpdb: &str) -> Vec<FontPackage> {
    let mut packages = Vec::new();
    let mut current = FontPackage::default();
    let mut in_runfiles = false;
    let mut finish = |package: &mut FontPackage| {
        let package = std::mem::take(package);
        let is_font = package.topics.iter().any(|t| t == "font" || t.starts_with("font-"));
        if is_font && !package.faces.is_empty() && !package.name.contains('.') {
            packages.push(package);
        }
    };
    for line in tlpdb.lines() {
        if let Some(entry) = line.strip_prefix(' ') {
            if !in_runfiles {
                continue;
            }
            let path = entry.split(' ').next().unwrap_or(entry);
            let path = path.strip_prefix("RELOC/").unwrap_or(path);
            let lower = path.to_ascii_lowercase();
            if (lower.starts_with("fonts/opentype/") || lower.starts_with("fonts/truetype/"))
                && (lower.ends_with(".otf") || lower.ends_with(".ttf"))
            {
                current.faces.push(path.to_owned());
            } else if lower.starts_with("fonts/type1/") {
                current.type1 = true;
            } else if let Some(name) = path.strip_suffix(".sty").filter(|_| path.starts_with("tex/latex/")) {
                current.styles.extend(name.rsplit('/').next().map(str::to_owned));
            }
        } else if let Some(name) = line.strip_prefix("name ") {
            finish(&mut current);
            current.name = name.to_owned();
            in_runfiles = false;
        } else {
            in_runfiles = line.starts_with("runfiles");
            if let Some(text) = line.strip_prefix("shortdesc ") {
                current.description = text.to_owned();
            } else if let Some(size) = line.strip_prefix("containersize ") {
                current.size = size.parse().unwrap_or(0);
            } else if let Some(sum) = line.strip_prefix("containerchecksum ") {
                current.checksum = sum.to_ascii_lowercase();
            } else if let Some(license) = line.strip_prefix("catalogue-license ") {
                current.license = license.to_owned();
            } else if let Some(topics) = line.strip_prefix("catalogue-topics ") {
                current.topics = topics.split(' ').map(str::to_owned).collect();
            }
        }
    }
    finish(&mut current);
    packages
}

/// What a face is within its family, by the end of its file name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Style {
    Regular,
    Italic,
    Bold,
    BoldItalic,
    Other,
}

fn style_of(suffix: &str) -> Style {
    match suffix.to_ascii_lowercase().replace([' ', '_', '-'], "").as_str() {
        "" | "regular" | "roman" | "book" | "normal" | "r" | "rg" | "upright" => Style::Regular,
        "italic" | "it" | "oblique" | "regularitalic" | "bookitalic" | "ri" | "i" => Style::Italic,
        "bold" | "bd" | "b" | "rb" => Style::Bold,
        "bolditalic" | "boldit" | "boldoblique" | "bi" | "rbi" | "z" => Style::BoldItalic,
        _ => Style::Other,
    }
}

/// `EBGaramond-Italic` → (`EBGaramond`, `Italic`); `LinLibertine_RB` → (`LinLibertine`, `RB`);
/// `FreeSerifBold` → (`FreeSerif`, `Bold`). Optical sizes are one family: `lmroman12-bold` → `lmroman`.
fn split_face(stem: &str) -> (String, String) {
    let (family, suffix) = match stem.rfind(['-', '_', ' ']) {
        Some(at) => (&stem[..at], &stem[at + 1..]),
        None => {
            let lower = stem.to_ascii_lowercase();
            let suffix = ["bolditalic", "boldoblique", "bold", "italic", "oblique"]
                .iter()
                .find(|s| lower.ends_with(*s) && lower.len() > s.len())
                .map_or(0, |s| s.len());
            stem.split_at(stem.len() - suffix)
        }
    };
    (family.trim_end_matches(|c: char| c.is_ascii_digit()).to_owned(), suffix.to_owned())
}

/// `EBGaramond` → `EB Garamond`, `LibertinusSerif` → `Libertinus Serif`.
fn display_name(stem: &str) -> String {
    let chars: Vec<char> = stem.chars().collect();
    let mut name = String::new();
    for (i, &c) in chars.iter().enumerate() {
        if i > 0 && c.is_ascii_uppercase() {
            let prev = chars[i - 1];
            let next_lower = chars.get(i + 1).is_some_and(|n| n.is_ascii_lowercase());
            if prev.is_ascii_lowercase() || prev.is_ascii_digit() || (prev.is_ascii_uppercase() && next_lower) {
                name.push(' ');
            }
        }
        name.push(c);
    }
    name
}

fn kind_of(family: &str, topics: &[String]) -> FontKind {
    let lower = family.to_ascii_lowercase();
    if lower.contains("math") {
        return FontKind::Math;
    }
    if lower.contains("mono") || lower.contains("code") || lower.contains("typewriter") {
        return FontKind::Mono;
    }
    if lower.contains("sans") {
        return FontKind::Sans;
    }
    if lower.contains("serif") {
        return FontKind::Serif;
    }
    let has = |topic: &str| topics.iter().any(|t| t == topic);
    if ["font-display", "font-decor", "font-calligraphic", "font-script", "font-novelty", "font-symbol"].iter().any(|t| has(t))
        && !has("font-body")
    {
        FontKind::Other
    } else if has("font-serif") {
        FontKind::Serif
    } else if has("font-sans") {
        FontKind::Sans
    } else if has("font-mono") {
        FontKind::Mono
    } else if has("font-maths") {
        FontKind::Math
    } else {
        FontKind::Other
    }
}

/// The families of `package`; `installed` is left for the caller.
pub fn families_of(package: &FontPackage) -> Vec<FontFamily> {
    // Family stem → its faces, by style. Of several faces with one style (optical sizes), the 10 pt one or the first.
    let mut grouped: BTreeMap<String, Vec<(Style, String)>> = BTreeMap::new();
    for face in &package.faces {
        let file = face.rsplit('/').next().unwrap_or(face);
        let stem = file.rsplit_once('.').map_or(file, |(stem, _)| stem);
        let (family, suffix) = split_face(stem);
        if family.is_empty() {
            continue;
        }
        grouped.entry(family).or_default().push((style_of(&suffix), face.clone()));
    }
    let real: Vec<&String> = grouped.keys().filter(|f| kind_of(f, &package.topics) != FontKind::Math).collect();
    let single = real.len() == 1;
    grouped
        .iter()
        .map(|(stem, faces)| {
            let pick = |style: Style| {
                let all: Vec<&String> = faces.iter().filter(|(s, _)| *s == style).map(|(_, f)| f).collect();
                all.iter().find(|f| f.contains("10")).or(all.first()).map(|f| (*f).clone())
            };
            let regular = pick(Style::Regular)
                .or_else(|| faces.iter().find(|(_, f)| f.to_ascii_lowercase().contains("regular")).map(|(_, f)| f.clone()))
                .unwrap_or_else(|| faces[0].1.clone());
            let kind = kind_of(stem, &package.topics);
            let sty = package.type1.then(|| {
                package
                    .styles
                    .iter()
                    .find(|s| s.eq_ignore_ascii_case(stem))
                    .or_else(|| package.styles.iter().find(|s| single && kind != FontKind::Math && s.eq_ignore_ascii_case(&package.name)))
                    .cloned()
            });
            FontFamily {
                id: format!("{}/{stem}", package.name),
                package: package.name.clone(),
                name: display_name(stem),
                kind,
                italic: pick(Style::Italic),
                bold: pick(Style::Bold),
                bold_italic: pick(Style::BoldItalic),
                regular,
                faces: faces.len(),
                sty: sty.flatten(),
                description: package.description.clone(),
                license: package.license.clone(),
                size: package.size,
                installed: false,
            }
        })
        .collect()
}

/// Every family of the repository, marked installed where its package is.
pub async fn families(paths: &AppPaths, index: &IndexCache) -> Result<Vec<FontFamily>, String> {
    let index = index.get(paths).await.ok_or_else(|| localized!("error_package_index_loading"))?;
    let installed = installed_packages(paths).await;
    Ok(index
        .fonts()
        .iter()
        .flat_map(|package| {
            let installed = installed.contains(&package.name);
            families_of(package).into_iter().map(move |family| FontFamily { installed, ..family })
        })
        .collect())
}

/// The packages the local database lists as installed.
async fn installed_packages(paths: &AppPaths) -> HashSet<String> {
    let file = paths.distribution().join("tlpkg/texlive.tlpdb");
    let text = tokio::fs::read_to_string(file).await.unwrap_or_default();
    text.lines().filter_map(|line| line.strip_prefix("name ")).map(str::to_owned).collect()
}

/// The repository tlmgr installs from, as the installation names it.
async fn repository(paths: &AppPaths) -> String {
    let file = paths.distribution().join("tlpkg/texlive.tlpdb");
    let text = tokio::fs::read_to_string(file).await.unwrap_or_default();
    text.lines()
        .find_map(|line| line.strip_prefix("depend opt_location:"))
        .filter(|location| location.starts_with("https://") || location.starts_with("http://"))
        .map_or_else(|| DEFAULT_REPOSITORY.to_owned(), |location| location.trim_end_matches('/').to_owned())
}

fn previews(paths: &AppPaths) -> PathBuf {
    paths.tex_root().join("font-previews")
}

/// Only one archive downloads at a time, so asking twice does not fetch it twice.
static DOWNLOAD: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// The font file `face` of `package` (as the catalog names it): from the
/// distribution where it is installed, else from the preview cache, which
/// gets the package's fonts from its archive the first time, but only with
/// `fetch` (the user agreed to downloads, or asked for this one): else `None`.
pub async fn face(paths: &AppPaths, index: &IndexCache, package: &str, face: &str, fetch: bool) -> Result<Option<Vec<u8>>, String> {
    let index = index.get(paths).await.ok_or_else(|| localized!("error_package_index_loading"))?;
    let entry = index
        .fonts()
        .iter()
        .find(|p| p.name == package && p.faces.iter().any(|f| f == face))
        .ok_or_else(|| localized!("error_package_font_missing", package = package, face = face))?;
    let installed = paths.distribution().join("texmf-dist").join(face);
    let cached = previews(paths).join(&entry.name).join(face);
    if let Ok(bytes) = tokio::fs::read(&installed).await {
        // Installed now: what was fetched for the preview is no longer needed.
        let _ = tokio::fs::remove_dir_all(previews(paths).join(&entry.name)).await;
        return Ok(Some(bytes));
    }
    if !fetch {
        return Ok(tokio::fs::read(&cached).await.ok());
    }
    let _download = DOWNLOAD.lock().await;
    if let Ok(bytes) = tokio::fs::read(&cached).await {
        return Ok(Some(bytes));
    }
    fetch_faces(paths, entry).await?;
    tokio::fs::read(&cached).await.map(Some).map_err(|e| format!("{}: {e}", cached.display()))
}

/// The host previews are fetched from (`tlnet.yihui.org`), for telling the user before.
pub async fn preview_host(paths: &AppPaths) -> String {
    let url = repository(paths).await;
    let rest = url.split_once("://").map_or(url.as_str(), |(_, rest)| rest);
    rest.split('/').next().unwrap_or(rest).to_owned()
}

/// Downloads the archive of `package` and keeps its font files in the preview cache.
async fn fetch_faces(paths: &AppPaths, package: &FontPackage) -> Result<(), String> {
    let url = format!("{}/archive/{}.tar.xz", repository(paths).await, package.name);
    let archive = reqwest::get(&url)
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Download fehlgeschlagen: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Download abgebrochen: {e}"))?;
    let sum: String = Sha512::digest(&archive).iter().map(|b| format!("{b:02x}")).collect();
    if sum != package.checksum {
        return Err(localized!("error_checksum", file = package.name));
    }
    let dest = previews(paths).join(&package.name);
    let wanted: HashSet<String> = package.faces.iter().cloned().collect();
    tokio::task::spawn_blocking(move || extract_faces(&archive, &wanted, &dest)).await.map_err(|e| e.to_string())?
}

/// Writes the entries of the `.tar.xz` `archive` named in `wanted` below `dest`.
fn extract_faces(archive: &[u8], wanted: &HashSet<String>, dest: &Path) -> Result<(), String> {
    let mut tar = Vec::new();
    lzma_rs::xz_decompress(&mut std::io::BufReader::new(archive), &mut tar).map_err(|e| format!("Entpacken fehlgeschlagen: {e}"))?;
    let mut entries = tar::Archive::new(tar.as_slice());
    for entry in entries.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
        // Only the names the database lists, so nothing lands outside `dest`.
        if !wanted.contains(&path) {
            continue;
        }
        let target = dest.join(&path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const TLPDB: &str = "\
name ebgaramond
category Package
shortdesc LaTeX support for EBGaramond fonts
containersize 8391124
containerchecksum ABC
runfiles size=5162
 RELOC/fonts/opentype/public/ebgaramond/EBGaramond-Bold.otf
 RELOC/fonts/opentype/public/ebgaramond/EBGaramond-BoldItalic.otf
 RELOC/fonts/opentype/public/ebgaramond/EBGaramond-Initials.otf
 RELOC/fonts/opentype/public/ebgaramond/EBGaramond-Italic.otf
 RELOC/fonts/opentype/public/ebgaramond/EBGaramond-Regular.otf
 RELOC/fonts/type1/public/ebgaramond/EBGaramond-Regular.pfb
 RELOC/tex/latex/ebgaramond/ebgaramond.sty
catalogue-license ofl lppl
catalogue-topics font font-body font-serif font-otf font-type1

name libertinus-fonts
containersize 1795384
runfiles size=936
 RELOC/fonts/opentype/public/libertinus-fonts/LibertinusMath-Regular.otf
 RELOC/fonts/opentype/public/libertinus-fonts/LibertinusSans-Regular.otf
 RELOC/fonts/opentype/public/libertinus-fonts/LibertinusSerif-Regular.otf
 RELOC/fonts/opentype/public/libertinus-fonts/LibertinusSerif-Italic.otf
catalogue-topics font font-body font-serif font-sans font-maths font-otf

name siunitx
runfiles size=10
 RELOC/tex/latex/siunitx/siunitx.sty
catalogue-topics units

name lm
runfiles size=10
 RELOC/fonts/opentype/public/lm/lmroman10-regular.otf
 RELOC/fonts/opentype/public/lm/lmroman12-regular.otf
 RELOC/fonts/opentype/public/lm/lmroman10-italic.otf
 RELOC/fonts/opentype/public/lm/lmsans10-regular.otf
catalogue-topics font font-body
";

    #[test]
    fn reads_font_packages() {
        let packages = parse_packages(TLPDB);
        assert_eq!(packages.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["ebgaramond", "libertinus-fonts", "lm"]);
        let garamond = &packages[0];
        assert_eq!(garamond.size, 8391124);
        assert_eq!(garamond.checksum, "abc");
        assert!(garamond.type1);
        assert_eq!(garamond.styles, ["ebgaramond"]);
        assert_eq!(garamond.license, "ofl lppl");
    }

    #[test]
    fn groups_faces_into_families() {
        let packages = parse_packages(TLPDB);
        let garamond = families_of(&packages[0]);
        assert_eq!(garamond.len(), 1);
        let family = &garamond[0];
        assert_eq!(family.name, "EB Garamond");
        assert_eq!(family.kind, FontKind::Serif);
        assert_eq!(family.regular, "fonts/opentype/public/ebgaramond/EBGaramond-Regular.otf");
        assert_eq!(family.bold_italic.as_deref(), Some("fonts/opentype/public/ebgaramond/EBGaramond-BoldItalic.otf"));
        assert_eq!(family.faces, 5);
        assert_eq!(family.sty.as_deref(), Some("ebgaramond"));

        let libertinus = families_of(&packages[1]);
        let names: Vec<_> = libertinus.iter().map(|f| (f.name.as_str(), f.kind)).collect();
        assert_eq!(
            names,
            [("Libertinus Math", FontKind::Math), ("Libertinus Sans", FontKind::Sans), ("Libertinus Serif", FontKind::Serif)]
        );
        assert!(libertinus.iter().all(|f| f.sty.is_none()), "no Type 1 fonts: XeLaTeX and LuaLaTeX only");

        let lm = families_of(&packages[2]);
        assert_eq!(lm.len(), 2, "optical sizes are one family");
        assert_eq!(lm[0].regular, "fonts/opentype/public/lm/lmroman10-regular.otf");
    }

    /// Against tlmgr's real database and repository: `GILGAMESH_TEST_BASE=... cargo test -- --ignored`
    /// (a base with a copy of `tex/distribution/tlpkg`; the preview lands in its `tex/font-previews`).
    #[tokio::test]
    #[ignore]
    async fn lists_and_fetches_real_fonts() {
        let paths = AppPaths::from_base(std::env::var("GILGAMESH_TEST_BASE").expect("GILGAMESH_TEST_BASE").into());
        let index = IndexCache::default();
        let all = families(&paths, &index).await.unwrap();
        println!("{} families", all.len());
        for kind in [FontKind::Serif, FontKind::Sans, FontKind::Mono, FontKind::Math, FontKind::Other] {
            let of: Vec<_> = all.iter().filter(|f| f.kind == kind).collect();
            let pdf = of.iter().filter(|f| f.sty.is_some()).count();
            println!("{kind:?}: {} ({pdf} for pdfLaTeX), e.g. {:?}", of.len(), of.iter().take(8).map(|f| &f.name).collect::<Vec<_>>());
        }
        let garamond = all.iter().find(|f| f.id == "ebgaramond/EBGaramond").expect("EB Garamond");
        assert_eq!(garamond.sty.as_deref(), Some("ebgaramond"));
        let libertinus = all.iter().find(|f| f.id == "libertinus-fonts/LibertinusSerif").expect("Libertinus Serif");
        let _ = std::fs::remove_dir_all(previews(&paths));
        assert_eq!(
            face(&paths, &index, "libertinus-fonts", &libertinus.regular, false).await.unwrap(),
            None,
            "nothing fetched without consent"
        );
        let bytes = face(&paths, &index, "libertinus-fonts", &libertinus.regular, true).await.unwrap().unwrap();
        assert_eq!(&bytes[..4], b"OTTO");
        let italic = libertinus.italic.as_ref().unwrap();
        assert!(face(&paths, &index, "libertinus-fonts", italic, false).await.unwrap().is_some(), "the archive's other faces are cached");
        assert!(face(&paths, &index, "libertinus-fonts", "../../secret.otf", true).await.is_err());
        assert_eq!(preview_host(&paths).await, "tlnet.yihui.org");
    }

    #[test]
    fn splits_face_names() {
        assert_eq!(split_face("LinLibertine_RB"), ("LinLibertine".into(), "RB".into()));
        assert_eq!(split_face("FreeSerifBold"), ("FreeSerif".into(), "Bold".into()));
        assert_eq!(split_face("FreeSerif"), ("FreeSerif".into(), "".into()));
        assert_eq!(style_of("BoldItalic"), Style::BoldItalic);
        assert_eq!(style_of("SemiBold"), Style::Other);
        assert_eq!(display_name("IBMPlexSans"), "IBM Plex Sans");
    }
}
