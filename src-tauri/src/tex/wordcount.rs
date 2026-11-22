//! Word counts with `texcount`, following `\input` and `\include`.

use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

use super::process;
use crate::paths::AppPaths;
use crate::util::i18n::localized;

#[derive(Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WordCount {
    /// Text, headings and captions together.
    pub total: u32,
    pub text: u32,
    pub headers: u32,
    pub captions: u32,
    /// Per chapter (or section), in reading order; the first is what comes before the first, with an empty title.
    pub parts: Vec<WordPart>,
}

#[derive(Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WordPart {
    pub title: String,
    /// Text, headings and captions together.
    pub words: u32,
}

/// Counts the document starting at `main`, in parts per `by` ("chapter" or "section"). `None` if texcount is not installed.
pub async fn count(paths: &AppPaths, main: &Path, by: &str) -> Result<Option<WordCount>, String> {
    let Some(mut cmd) = process::texcount_command(paths) else { return Ok(None) };
    let dir = main.parent().ok_or_else(|| localized!("error_invalid_path", path = main.display()))?;
    let by = if by == "chapter" { "chapter" } else { "section" };
    // Relative includes resolve against the main file's folder, like in the build;
    // merged in where they are read, so the parts follow the reading order.
    cmd.current_dir(dir).args(["-merge", "-utf8", "-sum", "-nocol", &format!("-sub={by}")]).arg(main.file_name().unwrap_or_default());
    let output = process::run_captured(cmd).await?;
    Ok(Some(parse(&output)))
}

/// `5+2+0 (2/0/0/0) Chapter: Einleitung`, `4+0+0 (0/0/0/0) _top_`.
static SUBCOUNT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*(\d+)\+(\d+)\+(\d+) \(\d+/\d+/\d+/\d+\) (?:\w+: )?(.*)$").unwrap());

/// A heading as plain text: `Fazit \emph{gut}` → "Fazit gut".
fn plain(title: &str) -> String {
    static COMMAND: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\[a-zA-Z]+\*?\s*").unwrap());
    let text = COMMAND.replace_all(title, "").replace(['{', '}'], "").replace('~', " ");
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse(output: &str) -> WordCount {
    let mut count = WordCount::default();
    for line in output.lines() {
        if let Some(c) = SUBCOUNT.captures(line) {
            let words = [&c[1], &c[2], &c[3]].iter().filter_map(|n| n.parse::<u32>().ok()).sum();
            let title = if &c[4] == "_top_" { String::new() } else { plain(&c[4]) };
            count.parts.push(WordPart { title, words });
            continue;
        }
        let Some((label, value)) = line.split_once(':') else { continue };
        let Ok(value) = value.trim().parse() else { continue };
        match label.trim() {
            "Sum count" => count.total = value,
            "Words in text" => count.text = value,
            "Words in headers" => count.headers = value,
            "Words outside text (captions, etc.)" => count.captions = value,
            _ => {}
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_texcount_totals() {
        let output = "Total\nSum count: 9528\nWords in text: 9152\nWords in headers: 102\n\
                      Words outside text (captions, etc.): 177\nNumber of headers: 49\n";
        assert_eq!(parse(output), WordCount { total: 9528, text: 9152, headers: 102, captions: 177, parts: vec![] });
    }

    #[test]
    fn parses_subcounts() {
        let output = "File: main.tex\nSum count: 17\nSubcounts:\n  text+headers+captions (#headers/#floats/#inlines/#displayed)\n  \
                      4+0+0 (0/0/0/0) _top_\n  5+2+0 (2/0/0/0) Chapter: Einleitung\n  4+2+0 (1/0/0/0) Chapter: Fazit \\emph{gut}\n";
        let parts: Vec<_> = parse(output).parts.into_iter().map(|p| (p.title, p.words)).collect();
        assert_eq!(parts, [(String::new(), 4), ("Einleitung".into(), 7), ("Fazit gut".into(), 6)]);
    }
}
