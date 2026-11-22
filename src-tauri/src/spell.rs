//! Spell checking with Hunspell dictionaries.
//!
//! Dictionaries are downloaded on first use per language (from the npm
//! packages of github.com/wooorm/dictionaries) into the app's data folder, so
//! the app ships none of their (partly GPL) data. Words the user adds go into
//! one plain text file that every language accepts: foreign words turn up in
//! any text, and the UI language need not be the document's.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use spellbook::Dictionary;

use crate::paths::AppPaths;
use crate::util::fs::write_atomic;
use crate::util::i18n::localized;

/// Dictionary codes that are known to exist (Latin-script European languages).
const DICTIONARIES: &[&str] = &[
    "de", "de-AT", "de-CH", "en", "en-GB", "fr", "es", "it", "nl", "pt-BR", "pt-PT", "pl", "sv", "da", "nb", "cs", "hu", "ro", "hr", "sl",
    "sk", "et", "lt", "lv", "ca", "tr",
];
const MAX_SUGGESTIONS: usize = 8;

/// babel/polyglossia language name to dictionary code.
pub fn dictionary_for(language: &str) -> Option<&'static str> {
    let code = match language.to_lowercase().as_str() {
        "ngerman" | "german" | "deutsch" => "de",
        "naustrian" | "austrian" => "de-AT",
        "nswissgerman" | "swissgerman" => "de-CH",
        "english" | "american" | "usenglish" | "canadian" => "en",
        "british" | "ukenglish" | "australian" | "newzealand" => "en-GB",
        "french" | "francais" | "acadian" | "canadien" => "fr",
        "spanish" | "spanishmx" => "es",
        "italian" => "it",
        "dutch" => "nl",
        "brazil" | "brazilian" => "pt-BR",
        "portuguese" | "portuges" => "pt-PT",
        "polish" => "pl",
        "swedish" => "sv",
        "danish" => "da",
        "norsk" | "norwegian" | "bokmal" => "nb",
        "czech" => "cs",
        "hungarian" | "magyar" => "hu",
        "romanian" => "ro",
        "croatian" => "hr",
        "slovene" | "slovenian" => "sl",
        "slovak" => "sk",
        "estonian" => "et",
        "lithuanian" => "lt",
        "latvian" => "lv",
        "catalan" => "ca",
        "turkish" => "tr",
        _ => return None,
    };
    Some(code)
}

#[derive(Default)]
pub struct SpellChecker {
    loaded: tokio::sync::Mutex<HashMap<String, Arc<Mutex<Dictionary>>>>,
}

impl SpellChecker {
    /// Words from `words` the dictionary does not know.
    pub async fn check(&self, paths: &AppPaths, code: &str, words: Vec<String>) -> Result<Vec<String>, String> {
        let dictionary = self.dictionary(paths, code).await?;
        let dictionary = dictionary.lock().unwrap();
        Ok(words.into_iter().filter(|w| !dictionary.check(w)).collect())
    }

    pub async fn suggest(&self, paths: &AppPaths, code: &str, word: &str) -> Result<Vec<String>, String> {
        let dictionary = self.dictionary(paths, code).await?;
        let mut suggestions = Vec::new();
        dictionary.lock().unwrap().suggest(word, &mut suggestions);
        suggestions.truncate(MAX_SUGGESTIONS);
        Ok(suggestions)
    }

    /// Accepts `word` in every language from now on, also after restarts.
    pub async fn add(&self, paths: &AppPaths, word: &str) -> Result<(), String> {
        let word = word.trim();
        if word.is_empty() || word.contains(char::is_whitespace) {
            return Err(localized!("error_invalid_word", word = word));
        }
        // Dictionaries loaded later read the file; those loaded already learn it here.
        for dictionary in self.loaded.lock().await.values() {
            dictionary.lock().unwrap().add(word).map_err(|e| e.to_string())?;
        }
        let file = user_words(paths);
        tokio::fs::create_dir_all(paths.user_dictionaries()).await.map_err(|e| e.to_string())?;
        let mut words = tokio::fs::read_to_string(&file).await.unwrap_or_default();
        if words.lines().any(|w| w == word) {
            return Ok(());
        }
        words.push_str(word);
        words.push('\n');
        tokio::fs::write(&file, words).await.map_err(|e| e.to_string())
    }

    /// The user's own words, sorted.
    pub async fn words(&self, paths: &AppPaths) -> Vec<String> {
        let mut words: Vec<String> = tokio::fs::read_to_string(user_words(paths))
            .await
            .unwrap_or_default()
            .lines()
            .filter(|w| !w.is_empty())
            .map(str::to_owned)
            .collect();
        words.sort_by_key(|w| w.to_lowercase());
        words.dedup();
        words
    }

    /// Takes a word out of the user's dictionary again.
    pub async fn remove(&self, paths: &AppPaths, word: &str) -> Result<(), String> {
        let file = user_words(paths);
        let text = tokio::fs::read_to_string(&file).await.unwrap_or_default();
        let kept: String = text.lines().filter(|w| *w != word && !w.is_empty()).map(|w| format!("{w}\n")).collect();
        tokio::fs::write(&file, kept).await.map_err(|e| e.to_string())?;
        // Hunspell dictionaries cannot forget a word: reload each on next use.
        self.loaded.lock().await.clear();
        Ok(())
    }

    async fn dictionary(&self, paths: &AppPaths, code: &str) -> Result<Arc<Mutex<Dictionary>>, String> {
        if !DICTIONARIES.contains(&code) {
            return Err(localized!("error_no_dictionary", language = code));
        }
        // Held across the download so one language is fetched only once.
        let mut loaded = self.loaded.lock().await;
        if let Some(dictionary) = loaded.get(code) {
            return Ok(dictionary.clone());
        }
        let dir = paths.dictionaries().join(code);
        let (aff, dic) = (dir.join("index.aff"), dir.join("index.dic"));
        if !aff.is_file() || !dic.is_file() {
            download(code, &dir).await?;
        }
        let user = user_words(paths);
        let dictionary = tokio::task::spawn_blocking(move || -> Result<Dictionary, String> {
            let aff = std::fs::read_to_string(aff).map_err(|e| e.to_string())?;
            let dic = std::fs::read_to_string(dic).map_err(|e| e.to_string())?;
            let mut dictionary = Dictionary::new(&aff, &dic).map_err(|e| e.to_string())?;
            for word in std::fs::read_to_string(user).unwrap_or_default().lines().filter(|w| !w.is_empty()) {
                let _ = dictionary.add(word);
            }
            Ok(dictionary)
        })
        .await
        .map_err(|e| e.to_string())??;
        let dictionary = Arc::new(Mutex::new(dictionary));
        loaded.insert(code.to_owned(), dictionary.clone());
        Ok(dictionary)
    }
}

/// The user's own words, for all languages. Earlier versions kept a file per
/// language (`user-de.txt`, …), first next to the downloaded dictionaries, then
/// in the user dictionary folder; on first use they are merged into this one.
fn user_words(paths: &AppPaths) -> PathBuf {
    let file = paths.user_dictionaries().join("user-words.txt");
    if file.exists() {
        return file;
    }
    let mut old = Vec::new();
    for dir in [paths.user_dictionaries(), paths.dictionaries()] {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("user-") && name.ends_with(".txt") {
                old.push(entry.path());
            }
        }
    }
    if old.is_empty() {
        return file;
    }
    let mut words: Vec<String> = old
        .iter()
        .filter_map(|path| std::fs::read_to_string(path).ok())
        .flat_map(|text| text.lines().filter(|w| !w.is_empty()).map(str::to_owned).collect::<Vec<_>>())
        .collect();
    words.sort();
    words.dedup();
    let merged: String = words.iter().map(|w| format!("{w}\n")).collect();
    // The old files go only once the merged one is written.
    if std::fs::create_dir_all(paths.user_dictionaries()).is_ok() && std::fs::write(&file, merged).is_ok() {
        for path in old {
            let _ = std::fs::remove_file(path);
        }
    }
    file
}

async fn download(code: &str, dir: &std::path::Path) -> Result<(), String> {
    let package = format!("dictionary-{}", code.to_lowercase());
    tokio::fs::create_dir_all(dir).await.map_err(|e| e.to_string())?;
    for file in ["index.aff", "index.dic"] {
        let url = format!("https://cdn.jsdelivr.net/npm/{package}@latest/{file}");
        let response = reqwest::get(&url).await.map_err(|e| localized!("error_dictionary_download", language = code, error = e))?;
        if !response.status().is_success() {
            return Err(localized!("error_dictionary_download", language = code, error = format!("HTTP {}", response.status())));
        }
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        // Written aside first: a half-downloaded file must not count as installed.
        write_atomic(&dir.join(file), &bytes).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::util::fs::TestDir;

    #[test]
    fn maps_babel_names_to_dictionaries() {
        assert_eq!(dictionary_for("ngerman"), Some("de"));
        assert_eq!(dictionary_for("british"), Some("en-GB"));
        assert_eq!(dictionary_for("UKenglish"), Some("en-GB"));
        assert_eq!(dictionary_for("klingon"), None);
        for code in DICTIONARIES {
            assert!(code.len() <= 5, "{code}");
        }
    }

    #[test]
    fn merges_word_files_of_earlier_versions() {
        let base = TestDir::new("words");
        let paths = AppPaths::from_base(base.to_path_buf());
        std::fs::create_dir_all(paths.user_dictionaries()).unwrap();
        std::fs::create_dir_all(paths.dictionaries()).unwrap();
        std::fs::write(paths.user_dictionaries().join("user-de.txt"), "Gilgamesh\nEnkidu\n").unwrap();
        std::fs::write(paths.dictionaries().join("user-en.txt"), "Gilgamesh\nUruk\n").unwrap();

        let file = user_words(&paths);
        let merged = std::fs::read_to_string(&file).unwrap();
        let old_left = paths.user_dictionaries().join("user-de.txt").exists() || paths.dictionaries().join("user-en.txt").exists();
        std::fs::remove_dir_all(base).unwrap();

        assert_eq!(merged, "Enkidu\nGilgamesh\nUruk\n");
        assert!(!old_left);
    }

    /// Downloads the German dictionary: `cargo test -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn checks_and_suggests_german() {
        let base = TestDir::new("spell");
        let paths = AppPaths::from_base(base.to_path_buf());
        let checker = SpellChecker::default();
        let wrong = checker
            .check(&paths, "de", vec!["Qualitätsmanagement".into(), "Qualität".into(), "Qualitat".into(), "Haus".into()])
            .await
            .unwrap();
        let suggestions = checker.suggest(&paths, "de", "Qualitat").await.unwrap();
        checker.add(&paths, "Gilgamesh").await.unwrap();
        let after_add = checker.check(&paths, "de", vec!["Gilgamesh".into()]).await.unwrap();
        // A fresh checker reads the user's words back.
        let reloaded = SpellChecker::default().check(&paths, "de", vec!["Gilgamesh".into()]).await.unwrap();
        let listed = checker.words(&paths).await;
        checker.remove(&paths, "Gilgamesh").await.unwrap();
        let after_remove = checker.check(&paths, "de", vec!["Gilgamesh".into()]).await.unwrap();
        std::fs::remove_dir_all(base).unwrap();

        assert_eq!(wrong, ["Qualitat"]);
        assert!(suggestions.contains(&"Qualität".to_owned()), "{suggestions:?}");
        assert!(after_add.is_empty() && reloaded.is_empty());
        assert_eq!(listed, ["Gilgamesh"]);
        assert_eq!(after_remove, ["Gilgamesh"]);
    }
}
