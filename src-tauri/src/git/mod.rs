//! Git for projects that live in a repository: whether Git is installed,
//! what the open project's repository is, cloning one as a new project, and
//! the work in it as VS Code's Git view offers it: changed files (from
//! `git status`), staging, committing and syncing with the remote.
//!
//! Gilgamesh ships no Git of its own; it uses the one installed on the
//! system, found on the PATH or where Git for Windows installs itself (apps
//! started from the desktop do not always see the PATH a terminal has).

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::util::i18n::localized;
use crate::util::process::hide_console;

pub mod trust;

/// Lines of Git's error output kept for the message.
const ERROR_LINES: usize = 4;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    /// Git is installed.
    pub available: bool,
    /// The project folder is (inside) a repository.
    pub repository: Option<Repository>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    /// The repository's folder on this computer: the project folder, or one it lies in.
    pub path: PathBuf,
    /// `None` on a detached HEAD.
    pub branch: Option<String>,
    /// Where `origin` points, if there is one.
    pub remote: Option<String>,
    /// Whether the user trusts it, so Git may work in it (see `trust`).
    pub trusted: bool,
}

/// The `git` program, if installed.
pub fn find() -> Option<PathBuf> {
    let name = if cfg!(windows) { "git.exe" } else { "git" };
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    if cfg!(windows) {
        for base in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
            if let Some(dir) = std::env::var_os(base) {
                dirs.push(PathBuf::from(dir).join("Git").join("cmd"));
            }
        }
        if let Some(local) = dirs::data_local_dir() {
            dirs.push(local.join("Programs").join("Git").join("cmd"));
        }
    }
    dirs.into_iter().map(|dir| dir.join(name)).find(|path| path.is_file())
}

/// The `git` program, or the message for a system without it.
pub fn require() -> Result<PathBuf, String> {
    find().ok_or_else(|| localized!("error_git_missing"))
}

/// Git and the repository of the project at `root`.
pub async fn info(root: &Path) -> GitInfo {
    let Some(git) = find() else { return GitInfo { available: false, repository: None } };
    let repository = match top_level(&git, root).await {
        Some(path) => {
            let branch = run(&git, Some(root), &["branch", "--show-current"]).await.ok().filter(|b| !b.is_empty());
            let remote = run(&git, Some(root), &["remote", "get-url", "origin"]).await.ok().filter(|r| !r.is_empty());
            Some(Repository { path, branch, remote, trusted: false })
        }
        None => None,
    };
    GitInfo { available: true, repository }
}

/// The folder of the repository `root` lies in, `None` outside of one.
pub async fn top_level(git: &Path, root: &Path) -> Option<PathBuf> {
    let top = run(git, Some(root), &["rev-parse", "--show-toplevel"]).await.ok().filter(|t| !t.is_empty())?;
    // Git writes forward slashes; shown to Windows users, the path should look like theirs.
    Some(PathBuf::from(if cfg!(windows) { top.replace('/', "\\") } else { top }))
}

/// Whether `url` is something `git clone` takes from a server: HTTP(S), SSH, or `user@host:path`.
pub fn is_remote_url(url: &str) -> bool {
    let url = url.trim();
    if url.is_empty() || url.starts_with('-') || url.chars().any(char::is_whitespace) {
        return false;
    }
    let scheme = ["https://", "http://", "ssh://", "git://", "git+ssh://"].iter().any(|s| url.starts_with(s));
    // scp-like SSH: `git@github.com:user/repo.git`; not a Windows drive (`C:\…`).
    let scp = url
        .split_once(':')
        .is_some_and(|(host, path)| host.contains('@') && !host.contains('/') && !path.is_empty() && !path.starts_with("//"));
    scheme || scp
}

/// Clones `url` into the new folder `parent/name` and returns it.
pub async fn clone(url: &str, parent: &Path, name: &str) -> Result<PathBuf, String> {
    let git = require()?;
    let url = url.trim();
    if !is_remote_url(url) {
        return Err(localized!("error_git_url_invalid", url = url));
    }
    let target = parent.join(name);
    if target.exists() {
        return Err(format!("{name} existiert bereits"));
    }
    let target_arg = target.to_string_lossy().into_owned();
    match run(&git, None, &["clone", "--", url, &target_arg]).await {
        Ok(_) => Ok(target),
        Err(e) => {
            // Git cleans up after itself, but not always after being stopped.
            if target.exists() && std::fs::read_dir(&target).is_ok_and(|mut d| d.next().is_none()) {
                let _ = std::fs::remove_dir(&target);
            }
            Err(e)
        }
    }
}

// ---------------------------------------------------------------- changes, commits, syncing

/// What `git status` knows: the branch, how it stands to its remote branch, and the changed files.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// `None` on a detached HEAD.
    pub branch: Option<String>,
    /// The remote branch it follows, e.g. "origin/main"; `None` before it is published.
    pub upstream: Option<String>,
    /// Commits here that the remote branch lacks, and the other way round.
    pub ahead: u32,
    pub behind: u32,
    /// Whether the repository has a remote to publish to.
    pub has_remote: bool,
    /// Whether anything was committed yet; a branch without remote branch then has commits to publish.
    pub has_commits: bool,
    pub files: Vec<FileChange>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    /// Relative to the repository's folder, with `/`.
    pub path: String,
    /// Relative to the project folder; `None` outside it (the project may be part of a larger repository).
    pub project_path: Option<String>,
    /// The name before a rename.
    pub original: Option<String>,
    /// The change in the staging area (the next commit), if any.
    pub staged: Option<ChangeKind>,
    /// The change in the files not staged yet, if any.
    pub unstaged: Option<ChangeKind>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    /// Not known to Git yet.
    Untracked,
    /// Changed on both sides of a merge.
    Conflict,
}

impl ChangeKind {
    /// One side of `git status`'s two-letter code; `None` for "unchanged".
    fn from_code(code: u8) -> Option<Self> {
        match code {
            b'M' | b'T' => Some(Self::Modified),
            b'A' => Some(Self::Added),
            b'D' => Some(Self::Deleted),
            b'R' | b'C' => Some(Self::Renamed),
            _ => None,
        }
    }
}

/// The repository's state, read with `git status --porcelain=v2`.
pub async fn status(root: &Path) -> Result<GitStatus, String> {
    let git = require()?;
    let prefix = run(&git, Some(root), &["rev-parse", "--show-prefix"]).await?;
    let output = run_raw(&git, Some(root), &["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]).await?;
    let has_remote = !run(&git, Some(root), &["remote"]).await.unwrap_or_default().is_empty();
    Ok(parse_status(&output, &prefix, has_remote))
}

fn parse_status(output: &str, prefix: &str, has_remote: bool) -> GitStatus {
    let mut status = GitStatus { branch: None, upstream: None, ahead: 0, behind: 0, has_remote, has_commits: false, files: Vec::new() };
    let project_path = |path: &str| path.strip_prefix(prefix).map(str::to_owned);
    let mut records = output.split('\0').filter(|r| !r.is_empty());
    while let Some(record) = records.next() {
        let (kind, rest) = record.split_once(' ').unwrap_or((record, ""));
        let codes = rest.as_bytes();
        let change = |path: &str, original: Option<String>, staged, unstaged| FileChange {
            path: path.to_owned(),
            project_path: project_path(path),
            original,
            staged,
            unstaged,
        };
        match kind {
            "#" => {
                if let Some(oid) = rest.strip_prefix("branch.oid ") {
                    // "(initial)" before the first commit.
                    status.has_commits = oid != "(initial)";
                } else if let Some(head) = rest.strip_prefix("branch.head ") {
                    status.branch = (head != "(detached)").then(|| head.to_owned());
                } else if let Some(upstream) = rest.strip_prefix("branch.upstream ") {
                    status.upstream = Some(upstream.to_owned());
                } else if let Some(counts) = rest.strip_prefix("branch.ab ") {
                    for count in counts.split(' ') {
                        if let Some(n) = count.strip_prefix('+') {
                            status.ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = count.strip_prefix('-') {
                            status.behind = n.parse().unwrap_or(0);
                        }
                    }
                }
            }
            // `1 XY sub mH mI mW hH hI path`
            "1" if codes.len() >= 2 => {
                if let Some(path) = rest.splitn(8, ' ').nth(7) {
                    status.files.push(change(path, None, ChangeKind::from_code(codes[0]), ChangeKind::from_code(codes[1])));
                }
            }
            // `2 XY sub mH mI mW hH hI Xscore path`, then the original path as a record of its own.
            "2" if codes.len() >= 2 => {
                let original = records.next().map(str::to_owned);
                if let Some(path) = rest.splitn(9, ' ').nth(8) {
                    status.files.push(change(path, original, ChangeKind::from_code(codes[0]), ChangeKind::from_code(codes[1])));
                }
            }
            // `u XY sub m1 m2 m3 mW h1 h2 h3 path`: a merge conflict.
            "u" => {
                if let Some(path) = rest.splitn(10, ' ').nth(9) {
                    status.files.push(change(path, None, None, Some(ChangeKind::Conflict)));
                }
            }
            "?" => status.files.push(change(rest, None, None, Some(ChangeKind::Untracked))),
            _ => {}
        }
    }
    status.files.sort_by(|a, b| a.path.cmp(&b.path));
    status
}

/// Puts the changes of `paths` (relative to the repository's folder) into the next commit.
pub async fn stage(root: &Path, paths: &[String]) -> Result<(), String> {
    let (git, top) = repository(root).await?;
    let mut args = vec!["add", "-A", "--"];
    args.extend(paths.iter().map(String::as_str));
    run(&git, Some(&top), &args).await.map(drop)
}

/// Takes the changes of `paths` out of the next commit again; the files keep them.
pub async fn unstage(root: &Path, paths: &[String]) -> Result<(), String> {
    let (git, top) = repository(root).await?;
    let has_commit = run(&git, Some(&top), &["rev-parse", "--verify", "--quiet", "HEAD"]).await.is_ok();
    // Before the first commit there is no HEAD to restore from: the files just leave the index.
    let mut args = if has_commit { vec!["restore", "--staged", "--"] } else { vec!["rm", "--cached", "-r", "-q", "--"] };
    args.extend(paths.iter().map(String::as_str));
    run(&git, Some(&top), &args).await.map(drop)
}

/// Commits what is staged, with `message`.
pub async fn commit(root: &Path, message: &str) -> Result<(), String> {
    let (git, top) = repository(root).await?;
    if message.trim().is_empty() {
        return Err(localized!("error_git_message_missing"));
    }
    run(&git, Some(&top), &["commit", "-m", message]).await.map(drop)
}

/// Brings in the remote branch's commits and sends this branch's, as VS Code's "Sync"
/// does; a branch without remote branch is published to `origin` (or the only remote).
pub async fn sync(root: &Path) -> Result<(), String> {
    let (git, top) = repository(root).await?;
    let state = status(&top).await?;
    if state.branch.is_none() {
        return Err(localized!("error_git_detached"));
    }
    if state.upstream.is_none() {
        let remotes = run(&git, Some(&top), &["remote"]).await?;
        let remote = remotes.lines().find(|r| *r == "origin").or_else(|| remotes.lines().next());
        let remote = remote.ok_or_else(|| localized!("error_git_no_remote"))?;
        return run(&git, Some(&top), &["push", "-u", remote, "HEAD"]).await.map(drop);
    }
    // Without a choice of the user's, merge: `git pull` would otherwise refuse diverged branches.
    let configured = run(&git, Some(&top), &["config", "--get", "pull.rebase"]).await.is_ok();
    let pull: &[&str] = if configured { &["pull", "--no-edit"] } else { &["pull", "--no-edit", "--no-rebase"] };
    run(&git, Some(&top), pull).await?;
    run(&git, Some(&top), &["push"]).await.map(drop)
}

/// Asks the remote what is new, for `behind`; changes nothing here.
pub async fn fetch(root: &Path) -> Result<(), String> {
    let (git, top) = repository(root).await?;
    run(&git, Some(&top), &["fetch", "--quiet"]).await.map(drop)
}

/// Who commits: Git's `user.name` and `user.email`, which a fresh installation lacks.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub name: Option<String>,
    pub email: Option<String>,
}

/// The identity Git commits with (from any of its configuration files).
pub async fn identity() -> Result<Identity, String> {
    let git = require()?;
    let get = |key: &'static str| {
        let git = git.clone();
        async move { run(&git, None, &["config", "--get", key]).await.ok().filter(|v| !v.is_empty()) }
    };
    Ok(Identity { name: get("user.name").await, email: get("user.email").await })
}

/// Sets the identity for all repositories of this user (`git config --global`).
pub async fn set_identity(name: &str, email: &str) -> Result<(), String> {
    let git = require()?;
    let (name, email) = (name.trim(), email.trim());
    if name.is_empty() || !email.contains('@') {
        return Err(localized!("error_git_identity_incomplete"));
    }
    run(&git, None, &["config", "--global", "user.name", name]).await?;
    run(&git, None, &["config", "--global", "user.email", email]).await.map(drop)
}

/// Makes the project at `root` a repository with all its files as first commit
/// (`message`), and `remote`, if given, as `origin` to publish to.
pub async fn init(root: &Path, message: &str, remote: Option<&str>) -> Result<(), String> {
    let git = require()?;
    if let Some(remote) = remote.filter(|r| !is_remote_url(r)) {
        return Err(localized!("error_git_url_invalid", url = remote));
    }
    init_folder(root).await?;
    run(&git, Some(root), &["add", "-A"]).await?;
    run(&git, Some(root), &["commit", "-q", "-m", message]).await?;
    if let Some(remote) = remote {
        set_remote(root, remote).await?;
    }
    Ok(())
}

/// Makes the folder `root` a repository, as VS Code's "Initialize Repository": nothing is
/// committed yet, all files show up as changes.
pub async fn init_folder(root: &Path) -> Result<(), String> {
    let git = require()?;
    // "main", as GitHub and GitLab name a new repository's branch, unless the user chose otherwise.
    let chosen = run(&git, None, &["config", "--get", "init.defaultBranch"]).await.is_ok();
    let init: &[&str] = if chosen { &["init", "-q"] } else { &["-c", "init.defaultBranch=main", "init", "-q"] };
    run(&git, Some(root), init).await.map(drop)
}

/// Makes `url` the repository's `origin`, the server it syncs with; replaces an older one.
pub async fn set_remote(root: &Path, url: &str) -> Result<(), String> {
    let (git, top) = repository(root).await?;
    let url = url.trim();
    if !is_remote_url(url) {
        return Err(localized!("error_git_url_invalid", url = url));
    }
    let exists = run(&git, Some(&top), &["remote", "get-url", "origin"]).await.is_ok();
    let args: &[&str] = if exists { &["remote", "set-url", "origin", url] } else { &["remote", "add", "origin", url] };
    run(&git, Some(&top), args).await.map(drop)
}

/// Git, and the folder of the repository `root` lies in.
pub async fn repository(root: &Path) -> Result<(PathBuf, PathBuf), String> {
    let git = require()?;
    let top = top_level(&git, root).await.ok_or_else(|| localized!("error_git_no_repository"))?;
    Ok((git, top))
}

/// Runs Git and returns its output, trimmed; its error output on failure.
async fn run(git: &Path, dir: Option<&Path>, args: &[&str]) -> Result<String, String> {
    run_raw(git, dir, args).await.map(|output| output.trim().to_owned())
}

/// Runs Git and returns its output as written; its error output on failure.
async fn run_raw(git: &Path, dir: Option<&Path>, args: &[&str]) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(git);
    if let Some(dir) = dir {
        cmd.arg("-C").arg(dir);
    }
    // The commands that read the working tree would start the program a repository
    // names here; never for one that is not trusted yet (see `trust`), and it only
    // makes Git faster where it is set up.
    cmd.args(["-c", "core.fsmonitor=false"]);
    cmd.args(args);
    // No window to type into: questions for a password or a host key must fail
    // instead of waiting forever. Credential helpers with a window of their own still work.
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    if std::env::var_os("GIT_SSH_COMMAND").is_none() {
        cmd.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes");
    }
    cmd.stdin(std::process::Stdio::null());
    hide_console(&mut cmd);
    let output = cmd.output().await.map_err(|e| localized!("error_program_start", program = "Git", error = e))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let lines: Vec<&str> = stderr.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with("Cloning into")).collect();
    let message = lines[lines.len().saturating_sub(ERROR_LINES)..].join("\n");
    Err(if message.is_empty() { localized!("error_git_exit", code = output.status.code().unwrap_or(-1)) } else { message })
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::util::fs::TestDir;

    #[test]
    fn knows_remote_urls() {
        for url in [
            "https://github.com/user/repo.git",
            "http://example.com/repo",
            "ssh://git@example.com:2222/repo.git",
            "git@github.com:user/repo.git",
            "  git@gitlab.com:group/sub/repo.git  ",
        ] {
            assert!(is_remote_url(url), "{url}");
        }
        for url in ["", "C:\\Users\\repo", "/home/user/repo", "--upload-pack=evil", "github.com/user/repo", "https://a b"] {
            assert!(!is_remote_url(url), "{url}");
        }
    }

    /// Needs Git and the network: `cargo test -- --ignored clones`.
    #[tokio::test]
    #[ignore]
    async fn clones_over_https_and_reports_failures() {
        let parent = TestDir::new("clone");
        let cloned = clone("https://github.com/octocat/Hello-World.git", &parent, "hello").await;
        let repository = info(&parent.join("hello")).await.repository;
        let again = clone("https://github.com/octocat/Hello-World.git", &parent, "hello").await;
        let missing = clone("https://github.com/octocat/does-not-exist-gilgamesh.git", &parent, "missing").await;
        let left_behind = parent.join("missing").exists();

        assert!(cloned.is_ok(), "{cloned:?}");
        let repository = repository.unwrap();
        assert_eq!(std::fs::canonicalize(&repository.path).ok(), std::fs::canonicalize(parent.join("hello")).ok());
        assert_eq!(repository.remote.as_deref(), Some("https://github.com/octocat/Hello-World.git"));
        assert!(repository.branch.is_some());
        assert!(again.unwrap_err().contains("existiert bereits"));
        println!("Fehlermeldung: {}", missing.as_ref().unwrap_err());
        assert!(missing.is_err() && !left_behind);
    }

    #[test]
    fn reads_porcelain_v2() {
        let output = [
            "# branch.oid abc",
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +2 -1",
            "1 .M N... 100644 100644 100644 aaa bbb thesis/main.tex",
            "1 A. N... 000000 100644 100644 000 ccc thesis/new file.tex",
            "1 MD N... 100644 100644 000000 ddd eee thesis/both.tex",
            "2 R. N... 100644 100644 100644 fff fff R100 thesis/renamed.tex",
            "thesis/old.tex",
            "u UU N... 100644 100644 100644 100644 a b c thesis/conflict.tex",
            "? README.md",
            "",
        ]
        .join("\0");
        let status = parse_status(&output, "thesis/", true);
        let files: Vec<_> = status.files.iter().map(|f| (f.path.as_str(), f.project_path.as_deref(), f.staged, f.unstaged)).collect();

        assert_eq!(
            (status.branch.as_deref(), status.upstream.as_deref(), status.ahead, status.behind),
            (Some("main"), Some("origin/main"), 2, 1)
        );
        assert!(status.has_commits);
        assert!(!parse_status("# branch.oid (initial)\0# branch.head main\0", "", false).has_commits);
        assert_eq!(
            files,
            [
                ("README.md", None, None, Some(ChangeKind::Untracked)),
                ("thesis/both.tex", Some("both.tex"), Some(ChangeKind::Modified), Some(ChangeKind::Deleted)),
                ("thesis/conflict.tex", Some("conflict.tex"), None, Some(ChangeKind::Conflict)),
                ("thesis/main.tex", Some("main.tex"), None, Some(ChangeKind::Modified)),
                ("thesis/new file.tex", Some("new file.tex"), Some(ChangeKind::Added), None),
                ("thesis/renamed.tex", Some("renamed.tex"), Some(ChangeKind::Renamed), None),
            ]
        );
        assert_eq!(status.files[5].original.as_deref(), Some("thesis/old.tex"));
    }

    /// Needs Git: a repository with a local "server" (a bare repository) as its remote.
    #[tokio::test]
    async fn stages_commits_and_syncs() {
        let Some(git) = find() else { return };
        let base = TestDir::new("sync");
        let (server, work) = (base.join("server.git"), base.join("work"));
        std::fs::create_dir_all(&work).unwrap();
        let git_in = |dir: &Path, args: &[&str]| {
            let (git, dir) = (git.clone(), dir.to_path_buf());
            let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
            async move { run(&git, Some(&dir), &args.iter().map(String::as_str).collect::<Vec<_>>()).await.unwrap() }
        };
        git_in(&base, &["init", "--bare", "-q", "-b", "main", "server.git"]).await;
        git_in(&work, &["init", "-q", "-b", "main"]).await;
        git_in(&work, &["config", "user.name", "Test"]).await;
        git_in(&work, &["config", "user.email", "test@example.com"]).await;
        git_in(&work, &["remote", "add", "origin", &server.to_string_lossy()]).await;
        std::fs::write(work.join("main.tex"), "Hallo\n").unwrap();

        let fresh = status(&work).await.unwrap();
        stage(&work, &["main.tex".into()]).await.unwrap();
        let staged = status(&work).await.unwrap();
        unstage(&work, &["main.tex".into()]).await.unwrap();
        let unstaged = status(&work).await.unwrap();
        stage(&work, &["main.tex".into()]).await.unwrap();
        let empty_message = commit(&work, "  ").await;
        commit(&work, "Erster Stand").await.unwrap();
        let committed = status(&work).await.unwrap();
        sync(&work).await.unwrap();
        let published = status(&work).await.unwrap();
        std::fs::write(work.join("main.tex"), "Hallo Welt\n").unwrap();
        stage(&work, &["main.tex".into()]).await.unwrap();
        commit(&work, "Zweiter Stand").await.unwrap();
        let ahead = status(&work).await.unwrap();
        sync(&work).await.unwrap();
        let synced = status(&work).await.unwrap();
        let on_server = git_in(&server, &["log", "--format=%s"]).await;

        let kinds = |s: &GitStatus| s.files.iter().map(|f| (f.staged, f.unstaged)).collect::<Vec<_>>();
        assert_eq!(kinds(&fresh), [(None, Some(ChangeKind::Untracked))]);
        assert!(!fresh.has_commits && committed.has_commits);
        assert_eq!(kinds(&staged), [(Some(ChangeKind::Added), None)]);
        assert_eq!(kinds(&unstaged), [(None, Some(ChangeKind::Untracked))]);
        assert!(empty_message.is_err());
        assert!(committed.files.is_empty() && committed.upstream.is_none() && committed.has_remote);
        assert_eq!(published.upstream.as_deref(), Some("origin/main"));
        assert_eq!((ahead.ahead, synced.ahead, synced.behind), (1, 0, 0));
        assert_eq!(on_server, "Zweiter Stand\nErster Stand");
    }

    /// Needs Git: a new project becomes a repository and is published to a local "server".
    #[tokio::test]
    async fn initializes_and_publishes_a_new_project() {
        let Some(git) = find() else { return };
        let base = TestDir::new("init");
        let (server, work) = (base.join("server.git"), base.join("thesis"));
        std::fs::create_dir_all(&work).unwrap();
        run(&git, Some(&base), &["init", "--bare", "-q", "server.git"]).await.unwrap();
        std::fs::write(work.join("main.tex"), "\\documentclass{article}\n").unwrap();
        let wrong_remote = init(&work, "Erster Stand", Some("not a url")).await;
        let repository_after_wrong_remote = work.join(".git").exists();
        // The test's identity in this repository only, not in the user's configuration;
        // `init` on a repository that exists already just goes on.
        run(&git, Some(&work), &["init", "-q"]).await.unwrap();
        run(&git, Some(&work), &["config", "user.name", "Test"]).await.unwrap();
        run(&git, Some(&work), &["config", "user.email", "test@example.com"]).await.unwrap();
        init(&work, "Erster Stand", None).await.unwrap();
        // A local "server" is no URL `init` takes from the user; it is added as Git would.
        run(&git, Some(&work), &["remote", "add", "origin", &server.to_string_lossy()]).await.unwrap();
        let before = status(&work).await.unwrap();
        sync(&work).await.unwrap();
        let after = status(&work).await.unwrap();
        let on_server = run(&git, Some(&server), &["log", "--format=%s"]).await.unwrap();

        // A wrong link is refused before anything is set up.
        assert!(wrong_remote.is_err() && !repository_after_wrong_remote);
        assert!(before.has_commits && before.upstream.is_none() && before.files.is_empty());
        assert!(after.upstream.is_some());
        assert_eq!(on_server, "Erster Stand");
    }

    /// Needs Git: an open folder becomes a repository with its files as changes, then gets a remote.
    #[tokio::test]
    async fn initializes_an_open_folder_and_connects_a_remote() {
        if find().is_none() {
            return;
        }
        let root = TestDir::new("init-folder");
        std::fs::write(root.join("main.tex"), "\\documentclass{article}\n").unwrap();

        init_folder(&root).await.unwrap();
        let fresh = status(&root).await.unwrap();
        let wrong = set_remote(&root, "not a url").await;
        set_remote(&root, "https://example.com/a.git").await.unwrap();
        set_remote(&root, "git@example.com:b.git").await.unwrap();
        let remote = info(&root).await.repository.and_then(|r| r.remote);

        assert!(!fresh.has_commits && !fresh.has_remote);
        assert_eq!(
            fresh.files.iter().map(|f| (f.path.as_str(), f.unstaged)).collect::<Vec<_>>(),
            [("main.tex", Some(ChangeKind::Untracked))]
        );
        assert!(wrong.is_err());
        assert_eq!(remote.as_deref(), Some("git@example.com:b.git"));
    }

    #[tokio::test]
    async fn plain_folder_is_no_repository() {
        let root = TestDir::new("git");
        let info = info(&root).await;
        assert_eq!(info.repository, None);
    }
}
