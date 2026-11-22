//! Package management through `tlmgr`.

use serde::Serialize;
use tauri::AppHandle;

use super::index::IndexCache;
use super::process;
use crate::paths::AppPaths;
use crate::util::i18n::localized;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub name: String,
    pub installed: bool,
    pub description: String,
}

/// Installed packages, or the whole remote catalog when `remote` is set.
pub async fn list(paths: &AppPaths, remote: bool) -> Result<Vec<Package>, String> {
    let mut cmd = process::tlmgr_command(paths)?;
    cmd.args(["info", "--data", "name,installed,shortdesc"]);
    if !remote {
        cmd.arg("--only-installed");
    }
    let output = process::run_captured(cmd).await?;
    Ok(output.lines().filter_map(parse_info_line).collect())
}

pub async fn install(app: &AppHandle, paths: &AppPaths, names: &[String]) -> Result<(), String> {
    check_names(names)?;
    run_mutating(app, paths, &["install"], names).await
}

pub async fn remove(app: &AppHandle, paths: &AppPaths, names: &[String]) -> Result<(), String> {
    check_names(names)?;
    run_mutating(app, paths, &["remove"], names).await
}

/// Package names as TeX Live has them (`siunitx`, `babel-german`, `latex-bin.windows`).
/// Anything else, an option like `--file` above all, never reaches `tlmgr`: names
/// can come from a document's log or from an AI assistant.
fn check_names(names: &[String]) -> Result<(), String> {
    let valid = |name: &String| {
        name.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
            && name.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
    };
    match names.iter().find(|name| !valid(name)) {
        Some(name) => Err(localized!("error_invalid_package_name", name = name)),
        None => Ok(()),
    }
}

pub async fn update_all(app: &AppHandle, paths: &AppPaths) -> Result<(), String> {
    run_mutating(app, paths, &["update", "--self", "--all"], &[]).await
}

/// Packages in the remote catalog that contain `file` (e.g. `siunitx.sty`).
pub async fn packages_for_file(paths: &AppPaths, index: &IndexCache, file: &str) -> Result<Vec<String>, String> {
    // Entries without an extension are already package names: programs
    // (`biber`, `makeindex`, `latexmk`), hyphenation patterns (`hyphen-german`)
    // and language modules (`glossaries-german`).
    if !file.contains('.') {
        return Ok(vec![file.to_owned()]);
    }
    if let Some(index) = index.get(paths).await {
        return Ok(index.package_for(file).map(str::to_owned).into_iter().collect());
    }
    // No local copy of the repository database yet: ask the repository.
    let mut cmd = process::tlmgr_command(paths)?;
    cmd.args(["search", "--global", "--file"]).arg(format!("/{file}"));
    Ok(parse_search(&process::run_captured(cmd).await?, file))
}

/// Packages from `tlmgr search --file` output ("pkgname:" followed by indented
/// paths) that ship `file` itself, not just documentation or sources with that name.
fn parse_search(output: &str, file: &str) -> Vec<String> {
    let mut packages: Vec<String> = Vec::new();
    let mut current: Option<&str> = None;
    for line in output.lines() {
        if !line.starts_with(char::is_whitespace) {
            current = line.strip_suffix(':').filter(|n| !n.is_empty() && !n.contains([' ', '.']));
            continue;
        }
        let path = line.trim();
        let runtime = path.ends_with(&format!("/{file}")) && !path.contains("/doc/") && !path.contains("/source/");
        if let Some(package) = current.filter(|_| runtime) {
            if !packages.iter().any(|p| p == package) {
                packages.push(package.to_owned());
            }
        }
    }
    packages
}

/// Runs a changing `tlmgr` command. While the repository has a newer `tlmgr`,
/// it refuses everything until it is updated itself: that happens first then.
async fn run_mutating(app: &AppHandle, paths: &AppPaths, args: &[&str], names: &[String]) -> Result<(), String> {
    match run_tlmgr(app, paths, args, names).await {
        Err(error) if needs_self_update(&error) => {
            run_tlmgr(app, paths, &["update", "--self"], &[]).await?;
            run_tlmgr(app, paths, args, names).await
        }
        result => result,
    }
}

/// `tlmgr`'s refusal while it is older than the repository's (its last lines, see `run_streaming`).
fn needs_self_update(error: &str) -> bool {
    error.contains("tlmgr itself needs to be updated") || error.contains("update-tlmgr-latest")
}

async fn run_tlmgr(app: &AppHandle, paths: &AppPaths, args: &[&str], names: &[String]) -> Result<(), String> {
    let mut cmd = process::tlmgr_command(paths)?;
    cmd.args(args).args(names);
    let result = process::run_streaming(app, cmd).await;
    process::run_pending_tlmgr_updater(paths).await?;
    result
}

/// Parses `name,installed,"short description"`.
fn parse_info_line(line: &str) -> Option<Package> {
    let mut fields = line.splitn(3, ',');
    let name = fields.next()?.trim();
    let installed = fields.next()?.trim() == "1";
    let description = fields.next().unwrap_or_default().trim();
    // Architecture-specific binaries (`pdftex.windows`) are internal packages.
    if name.is_empty() || name.contains([' ', '.']) {
        return None;
    }
    let description = description.strip_prefix('"').and_then(|d| d.strip_suffix('"')).unwrap_or(description);
    Some(Package { name: name.to_owned(), installed, description: description.to_owned() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_ignores_documentation_matches() {
        let output = "tlmgr: package repository https://mirror (verified)\n\
                      beamerthemeamurmaple:\n\
                      \ttexmf-dist/doc/latex/beamerthemeamurmaple/logo.png\n\
                      siunitx:\n\
                      \ttexmf-dist/tex/latex/siunitx/siunitx.sty\n";
        assert!(parse_search(output, "logo.png").is_empty());
        assert_eq!(parse_search(output, "siunitx.sty"), ["siunitx"]);
    }

    #[test]
    fn recognizes_outdated_tlmgr() {
        // The last lines `run_streaming` reports of the real refusal.
        let error = "and/or Windows systems:\n\
                     \x20 https://mirror.ctan.org/systems/texlive/tlnet/update-tlmgr-latest.exe\n\
                     Then continue with other updates as usual.\n\
                     ===============================================================================\n\
                     tlmgr.pl: Terminating; please see warning above!\n\
                     tlmgr.pl: package repository https://tlnet.yihui.org (not verified: pubkey missing)";
        assert!(needs_self_update(error));
        assert!(!needs_self_update("tlmgr.pl: package foo not present in repository."));
    }

    #[test]
    fn parses_info_lines() {
        let pkg = parse_info_line(r#"siunitx,0,"A comprehensive (SI) units package""#).unwrap();
        assert_eq!(pkg.name, "siunitx");
        assert!(!pkg.installed);
        assert_eq!(pkg.description, "A comprehensive (SI) units package");

        let pkg = parse_info_line(r#"amsmath,1,"AMS mathematical facilities, for LaTeX""#).unwrap();
        assert!(pkg.installed);
        assert_eq!(pkg.description, "AMS mathematical facilities, for LaTeX");

        assert!(parse_info_line("pdftex.windows,1,\"binaries\"").is_none());
        assert!(parse_info_line("tlmgr.pl: package repository x").is_none());
    }
}
