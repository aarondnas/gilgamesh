//! Offline lookup of which TeX Live package ships a file.
//!
//! tlmgr keeps a copy of the repository database (`texlive.tlpdb.main.<hash>`)
//! next to the local one. It lists every package's files by kind; only
//! `runfiles` are indexed, so a missing `logo.png` from the user's project does
//! not match some package's documentation and install it by accident.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use super::fonts::FontPackage;
use crate::paths::AppPaths;

#[derive(Debug, Default)]
pub struct PackageIndex {
    /// File name (without directories) to the package that installs it.
    files: HashMap<Box<str>, Arc<str>>,
    packages: HashSet<Arc<str>>,
    /// The packages with fonts the font manager offers.
    fonts: Vec<FontPackage>,
}

impl PackageIndex {
    pub fn parse(tlpdb: &str) -> Self {
        let mut files: HashMap<Box<str>, Arc<str>> = HashMap::new();
        let mut packages: HashSet<Arc<str>> = HashSet::new();
        let mut package: Option<Arc<str>> = None;
        let mut in_runfiles = false;
        for line in tlpdb.lines() {
            if let Some(entry) = line.strip_prefix(' ') {
                let (Some(package), true) = (&package, in_runfiles) else { continue };
                // Entries may carry attributes after the path (`path details=…`).
                let path = entry.split(' ').next().unwrap_or(entry);
                let Some(name) = path.rsplit('/').next().filter(|n| !n.is_empty()) else { continue };
                let stem = name.split('.').next().unwrap_or(name);
                files
                    .entry(name.into())
                    // Several packages can ship the same file; prefer the one named after it.
                    .and_modify(|existing| {
                        if **existing != *stem && **package == *stem {
                            *existing = package.clone();
                        }
                    })
                    .or_insert_with(|| package.clone());
            } else if let Some(name) = line.strip_prefix("name ") {
                // `pkg.windows` and `00texlive.*` are platform binaries and internals.
                package = (!name.contains('.')).then(|| Arc::from(name));
                packages.extend(package.clone());
                in_runfiles = false;
            } else {
                in_runfiles = line.starts_with("runfiles");
            }
        }
        Self { files, packages, fonts: super::fonts::parse_packages(tlpdb) }
    }

    pub fn package_for(&self, file: &str) -> Option<&str> {
        self.files.get(file).map(|p| &**p)
    }

    /// Whether the repository has a package of this name, e.g. a language module
    /// a package asked for (`glossaries-russian` does not exist).
    pub fn has_package(&self, name: &str) -> bool {
        self.packages.contains(name)
    }

    pub fn fonts(&self) -> &[FontPackage] {
        &self.fonts
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.files.len()
    }
}

/// The parsed index, rebuilt whenever tlmgr refreshes its copy of the database.
#[derive(Default)]
pub struct IndexCache {
    current: Mutex<Option<(PathBuf, SystemTime, Arc<PackageIndex>)>>,
}

impl IndexCache {
    /// `None` until tlmgr has contacted the repository once (it happens while
    /// installing the essential packages); callers then fall back to `tlmgr search`.
    pub async fn get(&self, paths: &AppPaths) -> Option<Arc<PackageIndex>> {
        let file = repository_database(&paths.distribution().join("tlpkg"))?;
        let modified = std::fs::metadata(&file).and_then(|m| m.modified()).ok()?;
        if let Some((path, time, index)) = &*self.current.lock().unwrap() {
            if *path == file && *time == modified {
                return Some(index.clone());
            }
        }
        let source = file.clone();
        let index = tokio::task::spawn_blocking(move || {
            let bytes = std::fs::read(&source).ok()?;
            Some(Arc::new(PackageIndex::parse(&String::from_utf8_lossy(&bytes))))
        })
        .await
        .ok()??;
        *self.current.lock().unwrap() = Some((file, modified, index.clone()));
        Some(index)
    }
}

/// tlmgr's cached copy of the main repository's database, the newest if several.
fn repository_database(tlpkg: &Path) -> Option<PathBuf> {
    std::fs::read_dir(tlpkg)
        .ok()?
        .filter_map(Result::ok)
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            name.starts_with("texlive.tlpdb.main.") && !name.ends_with(".lock")
        })
        .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok())
        .map(|e| e.path())
}

#[cfg(test)]
mod tests {
    use super::*;

    const TLPDB: &str = "\
name 00texlive.config
runfiles size=1
 RELOC/tex/internal.sty

name siunitx
category Package
runfiles size=10
 RELOC/tex/latex/siunitx/siunitx.sty
docfiles size=5
 RELOC/doc/latex/siunitx/logo.png details=\"Logo\"

name beamerthemeamurmaple
docfiles size=5
 RELOC/doc/latex/beamerthemeamurmaple/logo.png
runfiles size=3
 RELOC/tex/latex/beamerthemeamurmaple/beamerthemeamurmaple.sty

name biber.windows
binfiles arch=windows size=1
 bin/windows/biber.exe

name mwe
runfiles size=2
 RELOC/tex/latex/mwe/example-image.png
 RELOC/tex/latex/mwe/siunitx.sty
";

    /// Against tlmgr's real database: `GILGAMESH_TEST_BASE=... cargo test -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn resolves_files_from_the_real_database() {
        let paths = AppPaths::from_base(std::env::var("GILGAMESH_TEST_BASE").expect("GILGAMESH_TEST_BASE").into());
        let cache = IndexCache::default();
        let started = std::time::Instant::now();
        let index = cache.get(&paths).await.expect("tlmgr has no repository database yet");
        println!("{} files indexed in {:?}", index.len(), started.elapsed());

        for (file, package) in [
            ("siunitx.sty", "siunitx"),
            ("ngerman.ldf", "babel-german"),
            ("txsyc.tfm", "txfonts"),
            ("ts1-qtmr.tfm", "tex-gyre"),
            ("glossaries-german.ldf", "glossaries-german"),
            ("example-image.png", "mwe"),
        ] {
            assert_eq!(index.package_for(file), Some(package), "{file}");
        }
        for project_file in ["logo.png", "intro.tex", "figure1.pdf", "chapter1.tex"] {
            assert_eq!(index.package_for(project_file), None, "{project_file}");
        }

        let started = std::time::Instant::now();
        cache.get(&paths).await.unwrap();
        assert!(started.elapsed().as_millis() < 50, "second lookup must use the cache");
    }

    #[test]
    fn indexes_only_runfiles() {
        let index = PackageIndex::parse(TLPDB);
        assert_eq!(index.package_for("siunitx.sty"), Some("siunitx"), "prefers the package named after the file");
        assert_eq!(index.package_for("example-image.png"), Some("mwe"));
        assert_eq!(index.package_for("logo.png"), None, "documentation must not match");
        assert_eq!(index.package_for("biber.exe"), None);
        assert_eq!(index.package_for("internal.sty"), None);
        assert!(index.has_package("beamerthemeamurmaple"));
        assert!(!index.has_package("biber.windows"));
        assert!(!index.has_package("glossaries-russian"));
    }
}
