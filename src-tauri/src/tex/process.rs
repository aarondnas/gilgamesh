//! Running the distribution's programs (tlmgr, latexmk, texcount, …) with
//! its environment: their output captured or streamed to the page, and each
//! bound to the app so that it ends with it.

use std::collections::VecDeque;
use std::ffi::{OsStr, OsString};
use std::path::PathBuf;
use std::process::Stdio;

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;

use crate::paths::AppPaths;
use crate::util::i18n::localized;
use crate::util::process::hide_console;

/// Platform binary directory of the managed distribution, e.g. `bin/windows`.
pub fn bin_dir(paths: &AppPaths) -> Option<PathBuf> {
    std::fs::read_dir(paths.distribution().join("bin")).ok()?.filter_map(Result::ok).map(|entry| entry.path()).find(|path| path.is_dir())
}

pub fn executable(paths: &AppPaths, name: &str) -> Option<PathBuf> {
    let file = if cfg!(windows) { format!("{name}.exe") } else { name.to_owned() };
    let path = bin_dir(paths)?.join(file);
    path.is_file().then_some(path)
}

/// A command whose environment only sees the managed distribution.
pub fn tex_command(paths: &AppPaths, program: impl AsRef<OsStr>) -> Command {
    let mut cmd = Command::new(program);
    cmd.env("PATH", isolated_path(paths))
        .env("TEXMFHOME", paths.texmf_user())
        .env("TEXMFVAR", paths.texmf_var())
        .env("TEXMFCONFIG", paths.texmf_config())
        .stdin(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.env("PERL5LIB", paths.distribution().join("tlpkg").join("tlperl").join("lib"));
    hide_console(&mut cmd);
    cmd
}

/// `tlmgr` invocation.
///
/// On Windows `tlmgr.bat` is bypassed and `tlmgr.pl` is run with the bundled
/// Perl directly, because `cmd.exe` splits arguments at commas
/// (`--data name,installed` would break).
pub fn tlmgr_command(paths: &AppPaths) -> Result<Command, String> {
    #[cfg(windows)]
    {
        let dist = paths.distribution();
        let perl = dist.join("tlpkg/tlperl/bin/perl.exe");
        let script = dist.join("texmf-dist/scripts/texlive/tlmgr.pl");
        if !perl.is_file() || !script.is_file() {
            return Err(localized!("error_latex_missing"));
        }
        let mut cmd = tex_command(paths, perl);
        cmd.arg(script);
        Ok(cmd)
    }
    #[cfg(not(windows))]
    {
        let tlmgr = executable(paths, "tlmgr").ok_or_else(|| localized!("error_latex_missing"))?;
        Ok(tex_command(paths, tlmgr))
    }
}

/// `latexmk`, which reruns the engine and runs Biber and makeglossaries as
/// needed. Returns `None` if it is not installed.
///
/// On Windows it runs through the bundled Perl like `tlmgr`. On Unix it gets
/// its own process group, so `kill_tree` also reaches the engine it spawns.
pub fn latexmk_command(paths: &AppPaths) -> Option<Command> {
    let cmd = perl_script_command(paths, "latexmk/latexmk.pl", "latexmk")?;
    #[cfg(not(windows))]
    let cmd = {
        let mut cmd = cmd;
        cmd.process_group(0);
        cmd
    };
    Some(cmd)
}

/// `texcount`, which counts words in LaTeX sources. `None` if not installed.
pub fn texcount_command(paths: &AppPaths) -> Option<Command> {
    perl_script_command(paths, "texcount/texcount.pl", "texcount")
}

/// A Perl script from TeX Live: on Windows run with the bundled Perl (the
/// `.exe` wrappers need it on PATH anyway), elsewhere through its link in `bin`.
fn perl_script_command(paths: &AppPaths, script: &str, program: &str) -> Option<Command> {
    #[cfg(windows)]
    {
        let _ = program;
        let dist = paths.distribution();
        let perl = dist.join("tlpkg/tlperl/bin/perl.exe");
        let script = dist.join("texmf-dist/scripts").join(script);
        if !perl.is_file() || !script.is_file() {
            return None;
        }
        let mut cmd = tex_command(paths, perl);
        cmd.arg(script);
        Some(cmd)
    }
    #[cfg(not(windows))]
    {
        let _ = script;
        Some(tex_command(paths, executable(paths, program)?))
    }
}

/// Ties a build process and everything it starts to the lifetime of the app.
///
/// When the app exits (or is restarted by `tauri dev`), Rust only kills the
/// direct child, i.e. latexmk. The engine it started would keep writing into
/// the build directory and collide with the next build, which makes LuaTeX
/// crash with a Visual C++ runtime error. A job object with "kill on close"
/// lets Windows end the whole tree once the app's handle goes away.
pub fn bind_to_app(child: &tokio::process::Child) {
    #[cfg(windows)]
    job::assign(child);
    #[cfg(not(windows))]
    let _ = child;
}

#[cfg(windows)]
mod job {
    use std::sync::OnceLock;

    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    struct Job(HANDLE);
    // SAFETY: a job handle may be used from any thread.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    /// Never closed explicitly: the OS closes it when the app exits, which kills the jobs.
    static JOB: OnceLock<Option<Job>> = OnceLock::new();

    pub fn assign(child: &tokio::process::Child) {
        let (Some(job), Some(process)) = (JOB.get_or_init(create), child.raw_handle()) else {
            return;
        };
        // SAFETY: both handles are valid; failure only means the tree is not bound.
        unsafe {
            AssignProcessToJobObject(job.0, process as HANDLE);
        }
    }

    fn create() -> Option<Job> {
        // SAFETY: plain Win32 calls with a zeroed, correctly sized info struct.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&raw const info).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            (ok != 0).then_some(Job(job))
        }
    }
}

/// Kills the process and everything it started. Killing only latexmk would
/// leave the engine running and writing into the build directory.
pub async fn kill_tree(child: &mut tokio::process::Child) {
    if let Some(pid) = child.id() {
        #[cfg(windows)]
        {
            let mut cmd = Command::new("taskkill");
            hide_console(cmd.args(["/PID", &pid.to_string(), "/T", "/F"]));
            let _ = cmd.stdout(Stdio::null()).stderr(Stdio::null()).status().await;
        }
        // The process group latexmk leads (see `latexmk_command`), through the system call:
        // the `kill` program of procps-ng 3.3.17 (Ubuntu 22.04) does not read `kill -KILL -<pid>`
        // as that group and kills the user's other processes, this app among them.
        #[cfg(not(windows))]
        kill_group(pid);
    }
    let _ = child.kill().await;
}

/// Sends SIGKILL to the process group `group` leads; never to this app's own group.
#[cfg(not(windows))]
fn kill_group(group: u32) {
    let Ok(group) = libc::pid_t::try_from(group) else { return };
    // SAFETY: getpgrp has no preconditions.
    let own = unsafe { libc::getpgrp() };
    if group > 1 && group != own {
        // SAFETY: only sends a signal to the processes of that group.
        unsafe {
            libc::killpg(group, libc::SIGKILL);
        }
    }
}

/// `tlmgr update --self` on Windows leaves an updater script behind that the
/// `.bat` launcher would normally run.
pub async fn run_pending_tlmgr_updater(paths: &AppPaths) -> Result<(), String> {
    if !cfg!(windows) {
        return Ok(());
    }
    let updater = paths.distribution().join("temp").join("updater-w32");
    if !updater.is_file() {
        return Ok(());
    }
    let script = updater.with_extension("bat");
    tokio::fs::rename(&updater, &script).await.map_err(|e| e.to_string())?;
    let mut cmd = tex_command(paths, "cmd");
    cmd.arg("/C").arg(&script);
    run_captured(cmd).await.map(drop)
}

/// The program `cmd` runs, by its file name without extension (`tlmgr`, `perl`).
fn program_name(cmd: &Command) -> String {
    let program = std::path::Path::new(cmd.as_std().get_program());
    program.file_stem().unwrap_or(program.as_os_str()).to_string_lossy().into_owned()
}

/// Runs the command and returns stdout.
pub async fn run_captured(mut cmd: Command) -> Result<String, String> {
    let program = program_name(&cmd);
    let output = cmd.output().await.map_err(|e| localized!("error_program_start", program = program, error = e))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(last_lines(stderr.lines(), 6))
    }
}

/// Runs the command and forwards every output line as a `tex:log` event.
pub async fn run_streaming(app: &AppHandle, mut cmd: Command) -> Result<(), String> {
    let program = program_name(&cmd);
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| localized!("error_program_start", program = program, error = e))?;
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    let (_, stderr_tail) = tokio::join!(forward_lines(app, stdout), forward_lines(app, stderr));
    let status = child.wait().await.map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(last_lines(stderr_tail.iter().map(String::as_str), 6))
    }
}

async fn forward_lines(app: &AppHandle, stream: impl AsyncRead + Unpin) -> VecDeque<String> {
    let mut reader = BufReader::new(stream);
    let mut buf = Vec::new();
    let mut tail = VecDeque::new();
    while reader.read_until(b'\n', &mut buf).await.is_ok_and(|n| n > 0) {
        let line = String::from_utf8_lossy(&buf).trim_end().to_owned();
        buf.clear();
        if line.is_empty() {
            continue;
        }
        let _ = app.emit("tex:log", &line);
        tail.push_back(line);
        if tail.len() > 20 {
            tail.pop_front();
        }
    }
    tail
}

fn last_lines<'a>(lines: impl Iterator<Item = &'a str>, n: usize) -> String {
    let lines: Vec<_> = lines.filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

fn isolated_path(paths: &AppPaths) -> OsString {
    let mut dirs: Vec<PathBuf> = bin_dir(paths).into_iter().collect();
    if cfg!(windows) {
        dirs.push(paths.distribution().join("tlpkg").join("tlperl").join("bin"));
    }
    // Drop other TeX installations (e.g. a system-wide MiKTeX) so they are
    // never picked up implicitly.
    let kpsewhich = if cfg!(windows) { "kpsewhich.exe" } else { "kpsewhich" };
    if let Some(system) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&system).filter(|dir| !dir.join(kpsewhich).is_file()));
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    /// Whether `pid` is still running (not gone, not a zombie waiting to be reaped).
    fn running(pid: &str) -> bool {
        std::fs::read_to_string(format!("/proc/{pid}/stat"))
            .is_ok_and(|stat| stat.rsplit_once(") ").is_some_and(|(_, rest)| !rest.starts_with('Z')))
    }

    /// Like a build: latexmk in a group of its own, the engine it started inside. Both end,
    /// and only they: the test itself survives (procps' `kill -KILL -<pid>` killed it).
    #[tokio::test]
    async fn kill_tree_ends_the_build_and_nothing_else() {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", "sleep 300 & echo $!; wait"]).process_group(0).stdout(Stdio::piped());
        let mut child = cmd.spawn().unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).await.unwrap();
        let engine = line.trim().to_owned();
        assert!(running(&engine));

        kill_tree(&mut child).await;
        for _ in 0..50 {
            if !running(&engine) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        assert!(!running(&engine), "the engine outlived its build");
    }
}
