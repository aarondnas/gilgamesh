//! Writing files so that a crash or a reader in between never sees half of one.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// Where a file is written before it replaces `file`: next to it, `.part` appended.
fn partial(file: &Path) -> PathBuf {
    let mut name = file.file_name().map(OsString::from).unwrap_or_default();
    name.push(".part");
    file.with_file_name(name)
}

/// Writes `contents` aside first and then replaces `file` in one step.
pub async fn write_atomic(file: &Path, contents: impl AsRef<[u8]>) -> Result<(), String> {
    let partial = partial(file);
    tokio::fs::write(&partial, contents).await.map_err(|e| e.to_string())?;
    tokio::fs::rename(&partial, file).await.map_err(|e| e.to_string())
}

/// [`write_atomic`] for code that does not run on the async runtime.
pub fn write_atomic_sync(file: &Path, contents: impl AsRef<[u8]>) -> Result<(), String> {
    let partial = partial(file);
    std::fs::write(&partial, contents).map_err(|e| e.to_string())?;
    std::fs::rename(&partial, file).map_err(|e| e.to_string())
}

/// A fresh folder for a test under the system's temp folder, named after the
/// test and this process; removed again when it goes out of scope.
#[cfg(test)]
pub struct TestDir(PathBuf);

#[cfg(test)]
impl TestDir {
    pub fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("gilgamesh-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("test folder");
        Self(dir)
    }
}

#[cfg(test)]
impl std::ops::Deref for TestDir {
    type Target = Path;

    fn deref(&self) -> &Path {
        &self.0
    }
}

#[cfg(test)]
impl AsRef<Path> for TestDir {
    fn as_ref(&self) -> &Path {
        &self.0
    }
}

#[cfg(test)]
impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn replaces_files_whole() {
        let dir = std::env::temp_dir().join(format!("gilgamesh-atomic-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("settings.json");

        write_atomic(&file, "one").await.unwrap();
        write_atomic_sync(&file, "two").unwrap();
        let content = std::fs::read_to_string(&file).unwrap();
        let leftovers = std::fs::read_dir(&dir).unwrap().count();
        std::fs::remove_dir_all(&dir).unwrap();

        assert_eq!(partial(&file), dir.join("settings.json.part"));
        assert_eq!((content.as_str(), leftovers), ("two", 1));
    }
}
