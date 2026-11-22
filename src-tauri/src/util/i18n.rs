//! Messages for the user, in the user's language. The backend does not know that
//! language, so it sends the key of a message in `messages/*.json` with its
//! parameters as one line of JSON, which `localize` in `src/lib/api/localize.ts`
//! translates. Text from elsewhere (TeX, Git, the system) passes through as it is.
//!
//! Text only AI assistants read (see `mcp`) stays English instead.

use serde_json::{json, Map, Value};

/// The message `key` with its parameters, e.g. `localized!("error_invalid_name", name = name)`.
/// Each parameter is formatted with `Display`.
macro_rules! localized {
    ($key:literal $(, $name:ident = $value:expr)* $(,)?) => {
        $crate::util::i18n::encode($key, &[$((stringify!($name), $value.to_string())),*])
    };
}
pub(crate) use localized;

/// See [`localized!`].
pub fn encode(key: &str, params: &[(&str, String)]) -> String {
    let params: Map<String, Value> = params.iter().map(|(name, value)| ((*name).to_owned(), Value::String(value.clone()))).collect();
    json!({ "message": key, "params": params }).to_string()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::path::Path;

    use super::*;

    #[test]
    fn encodes_key_and_params() {
        let text = localized!("error_invalid_name", name = "a\"b");
        let value: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value, json!({ "message": "error_invalid_name", "params": { "name": "a\"b" } }));
        // What `localize` recognizes.
        assert!(text.starts_with(r#"{"message":"#));
    }

    /// The key and parameter names of each `localized!(…)` in `text`.
    fn calls(text: &str) -> Vec<(String, BTreeSet<String>)> {
        let mut found = Vec::new();
        for (start, _) in text.match_indices("localized!(") {
            // The arguments up to the matching parenthesis, split at top-level commas.
            let rest = &text[start + "localized!(".len()..];
            let (mut depth, mut quoted, mut parts, mut part) = (0, false, Vec::new(), String::new());
            for c in rest.chars() {
                match c {
                    '"' => quoted = !quoted,
                    '(' | '[' | '{' if !quoted => depth += 1,
                    ')' if !quoted && depth == 0 => break,
                    ')' | ']' | '}' if !quoted => depth -= 1,
                    ',' if !quoted && depth == 0 => {
                        parts.push(std::mem::take(&mut part));
                        continue;
                    }
                    _ => {}
                }
                part.push(c);
            }
            parts.push(part);
            let key = parts[0].trim().trim_matches('"').to_owned();
            let params = parts[1..]
                .iter()
                .filter_map(|p| p.split_once('=').map(|(name, _)| name.trim().to_owned()))
                .filter(|name| !name.is_empty())
                .collect();
            found.push((key, params));
        }
        found
    }

    /// Every `localized!` in the sources names a message that every language
    /// has, with the parameters it uses.
    #[test]
    fn every_message_exists_in_every_language() {
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        let mut used: Vec<(String, BTreeSet<String>, String)> = Vec::new();
        let mut stack = vec![manifest.join("src")];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().is_some_and(|e| e == "rs") && !path.ends_with("i18n.rs") {
                    let text = std::fs::read_to_string(&path).unwrap();
                    for (key, params) in calls(&text) {
                        used.push((key, params, path.display().to_string()));
                    }
                }
            }
        }
        assert!(used.len() > 20, "found only {} messages", used.len());

        let placeholder = regex::Regex::new(r"\{([a-z_]+)\}").unwrap();
        for language in std::fs::read_dir(manifest.join("../messages")).unwrap().flatten() {
            let messages: Value = serde_json::from_str(&std::fs::read_to_string(language.path()).unwrap()).unwrap();
            let language = language.file_name().to_string_lossy().into_owned();
            for (key, params, file) in &used {
                let text = messages[key].as_str().unwrap_or_else(|| panic!("{language} lacks {key} (used in {file})"));
                let wanted: BTreeSet<String> = placeholder.captures_iter(text).map(|p| p[1].to_owned()).collect();
                assert_eq!(&wanted, params, "{language}: parameters of {key} (used in {file})");
            }
        }
    }
}
