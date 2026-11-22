//! EPS figures as PDF, for showing them in a tab: the webview cannot draw
//! PostScript. `epstopdf` of the managed distribution converts them with
//! Ghostscript (on Windows TeX Live's own, in `tlpkg/tlgs`) into the scratch
//! folder; the PDF is read back and removed again.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use super::process;
use crate::paths::AppPaths;
use crate::util::i18n::localized;

/// The TeX Live package that brings `epstopdf`.
pub const PACKAGE: &str = "epstopdf";

/// Tells several conversions at the same time apart.
static NEXT: AtomicU64 = AtomicU64::new(0);

/// Whether `epstopdf` is installed.
pub fn available(paths: &AppPaths) -> bool {
    process::executable(paths, "epstopdf").is_some()
}

/// The PDF for `eps`. Fails with Ghostscript's last lines if it cannot be converted.
pub async fn to_pdf(paths: &AppPaths, eps: &Path) -> Result<Vec<u8>, String> {
    let program = process::executable(paths, "epstopdf").ok_or_else(|| localized!("error_program_missing", program = "epstopdf"))?;
    let out = paths.scratch().join(format!("eps-{}-{}.pdf", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    let mut cmd = process::tex_command(paths, program);
    cmd.arg(format!("--outfile={}", out.display())).arg(eps);
    let converted = process::run_captured(cmd).await;
    let bytes = match converted {
        Ok(_) => tokio::fs::read(&out).await.map_err(|e| format!("{}: {e}", eps.display())),
        Err(e) => Err(e),
    };
    let _ = tokio::fs::remove_file(&out).await;
    bytes
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::util::fs::TestDir;

    /// Needs a TinyTeX installation at `$GILGAMESH_TEST_BASE/tex/distribution`:
    /// `GILGAMESH_TEST_BASE=... cargo test -- --ignored converts_eps`
    #[tokio::test]
    #[ignore]
    async fn converts_eps() {
        let base = std::env::var("GILGAMESH_TEST_BASE").expect("GILGAMESH_TEST_BASE");
        let paths = AppPaths::from_base(base.into());
        std::fs::create_dir_all(paths.scratch()).unwrap();
        let dir = TestDir::new("eps");
        let eps = dir.join("Abbildung mit Leerzeichen.eps");
        std::fs::write(
            &eps,
            "%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 60\nnewpath 10 10 moveto 90 10 lineto 50 50 lineto closepath fill\nshowpage\n%%EOF\n",
        )
        .unwrap();
        let pdf = to_pdf(&paths, &eps).await.unwrap();
        assert!(pdf.starts_with(b"%PDF"));
        // Nothing is left behind in the scratch folder.
        let left = std::fs::read_dir(paths.scratch()).unwrap().flatten().any(|e| e.file_name().to_string_lossy().starts_with("eps-"));
        assert!(!left);

        std::fs::write(&eps, "kein PostScript").unwrap();
        assert!(to_pdf(&paths, &eps).await.is_err());
    }
}
