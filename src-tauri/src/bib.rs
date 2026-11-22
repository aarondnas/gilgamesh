//! Bibliography entries fetched by their identifier, for the "add source"
//! dialog: a DOI from doi.org (which gives BibTeX itself), an ISBN from Open
//! Library (whose data becomes a `@book` entry here).

use std::time::Duration;

use serde_json::Value;

const TIMEOUT: Duration = Duration::from_secs(15);

/// What `id` is: a DOI (`10.1000/xyz`, also as a doi.org link or with `doi:`), else an ISBN.
enum Identifier {
    Doi(String),
    Isbn(String),
}

fn identify(id: &str) -> Result<Identifier, String> {
    let id = id.trim();
    let lower = id.to_lowercase();
    for prefix in ["https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "http://dx.doi.org/", "doi:"] {
        if lower.starts_with(prefix) {
            return Ok(Identifier::Doi(id[prefix.len()..].trim().to_owned()));
        }
    }
    if id.starts_with("10.") && id.contains('/') {
        return Ok(Identifier::Doi(id.to_owned()));
    }
    let digits: String = id.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_uppercase();
    let digits = digits.strip_prefix("ISBN").unwrap_or(&digits).to_owned();
    let valid = (digits.len() == 10
        && digits[..9].chars().all(|c| c.is_ascii_digit())
        && digits.ends_with(|c: char| c.is_ascii_digit() || c == 'X'))
        || (digits.len() == 13 && digits.chars().all(|c| c.is_ascii_digit()));
    if valid {
        Ok(Identifier::Isbn(digits))
    } else {
        Err("not-an-identifier".into())
    }
}

/// The BibTeX entry for a DOI or an ISBN. Errors are `not-an-identifier`,
/// `not-found` or the network's own message.
pub async fn lookup(id: &str) -> Result<String, String> {
    let client = reqwest::Client::builder().timeout(TIMEOUT).build().map_err(|e| e.to_string())?;
    match identify(id)? {
        Identifier::Doi(doi) => {
            let response = client
                .get(format!("https://doi.org/{doi}"))
                .header("Accept", "application/x-bibtex; charset=utf-8")
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if !response.status().is_success() {
                return Err("not-found".into());
            }
            let text = response.text().await.map_err(|e| e.to_string())?;
            if !text.trim_start().starts_with('@') {
                return Err("not-found".into());
            }
            Ok(text.trim().to_owned())
        }
        Identifier::Isbn(isbn) => {
            let data: Value = client
                .get(format!("https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data"))
                .send()
                .await
                .map_err(|e| e.to_string())?
                .json()
                .await
                .map_err(|e| e.to_string())?;
            let book = data.get(format!("ISBN:{isbn}")).ok_or("not-found")?;
            Ok(book_entry(book, &isbn))
        }
    }
}

/// A `@book` entry from Open Library's data.
fn book_entry(book: &Value, isbn: &str) -> String {
    let text = |value: Option<&Value>| value.and_then(Value::as_str).unwrap_or_default().trim().to_owned();
    let names = |key: &str| -> Vec<String> {
        book.get(key)
            .and_then(Value::as_array)
            .map(|list| list.iter().map(|entry| text(entry.get("name"))).filter(|n| !n.is_empty()).collect())
            .unwrap_or_default()
    };
    let title = match text(book.get("subtitle")) {
        subtitle if subtitle.is_empty() => text(book.get("title")),
        subtitle => format!("{}: {subtitle}", text(book.get("title"))),
    };
    let authors = names("authors");
    let year: String = text(book.get("publish_date")).chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    let year = if year.chars().all(|c| c.is_ascii_digit()) { year } else { String::new() };
    let publisher = names("publishers").into_iter().next().unwrap_or_default();
    let place =
        book.get("publish_places").and_then(Value::as_array).and_then(|list| list.first()).map(|p| text(p.get("name"))).unwrap_or_default();
    let surname = authors.first().and_then(|a| a.split_whitespace().last()).unwrap_or("book");
    let key: String = format!("{surname}{year}").chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase();
    let mut fields = vec![
        ("author", authors.join(" and ")),
        ("title", title),
        ("publisher", publisher),
        ("address", place),
        ("year", year),
        ("isbn", isbn.to_owned()),
    ];
    fields.retain(|(_, value)| !value.is_empty());
    let body: Vec<String> = fields.iter().map(|(name, value)| format!("  {name} = {{{value}}}")).collect();
    format!("@book{{{key},\n{}\n}}", body.join(",\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_dois_and_isbns() {
        assert!(matches!(identify("https://doi.org/10.1145/359576.359579"), Ok(Identifier::Doi(d)) if d == "10.1145/359576.359579"));
        assert!(matches!(identify("doi:10.1000/x"), Ok(Identifier::Doi(_))));
        assert!(matches!(identify("978-3-16-148410-0"), Ok(Identifier::Isbn(i)) if i == "9783161484100"));
        assert!(matches!(identify("ISBN 0-201-13447-0"), Ok(Identifier::Isbn(i)) if i == "0201134470"));
        assert!(identify("Knuth").is_err());
    }

    #[test]
    fn makes_a_book_entry() {
        let book: Value = serde_json::from_str(
            r#"{"title": "The TeXbook", "authors": [{"name": "Donald E. Knuth"}], "publishers": [{"name": "Addison-Wesley"}], "publish_date": "1984"}"#,
        )
        .unwrap();
        let entry = book_entry(&book, "0201134470");
        assert!(entry.starts_with("@book{knuth1984,\n"));
        assert!(entry.contains("  author = {Donald E. Knuth},\n") && entry.contains("  year = {1984}"));
    }
}
