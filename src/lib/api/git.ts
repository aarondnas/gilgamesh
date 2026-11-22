// Git for projects in a repository (src-tauri/src/commands/git.rs).
import { invoke } from "@tauri-apps/api/core";

/** Whether Git is installed, and the open project's repository (see `git.rs`). */
export interface GitInfo {
  available: boolean;
  /** `trusted`: the user trusts its authors, so Git may work in it (see `git/trust.rs`). */
  repository: { path: string; branch: string | null; remote: string | null; trusted: boolean } | null;
}

export type GitChangeKind = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";

/** A changed file, as `git status` reports it (see `git.rs`). */
export interface GitFileChange {
  /** Relative to the repository's folder. */
  path: string;
  /** Relative to the project folder; `null` outside it. */
  projectPath: string | null;
  /** The name before a rename. */
  original: string | null;
  /** The change staged for the next commit, if any. */
  staged: GitChangeKind | null;
  /** The change not staged yet, if any. */
  unstaged: GitChangeKind | null;
}

export interface GitStatus {
  branch: string | null;
  /** The remote branch followed, e.g. "origin/main"; `null` before it is published. */
  upstream: string | null;
  ahead: number;
  behind: number;
  hasRemote: boolean;
  /** Whether anything was committed yet. */
  hasCommits: boolean;
  files: GitFileChange[];
}

/** Who commits; a fresh installation lacks both. */
export interface GitIdentity {
  name: string | null;
  email: string | null;
}

export const gitApi = {
  gitInfo: (root: string) => invoke<GitInfo>("git_info", { root }),
  /** The user trusts the authors of the project's repository: Git may work in it from now on. */
  gitTrust: (root: string) => invoke<void>("git_trust", { root }),
  /** Shows the folder of the repository the project lies in, in the file manager. */
  gitOpenFolder: (root: string) => invoke<void>("git_open_folder", { root }),
  gitStatus: (root: string) => invoke<GitStatus>("git_status", { root }),
  /** `paths` relative to the repository's folder, as `GitFileChange.path`. */
  gitStage: (root: string, paths: string[]) => invoke<void>("git_stage", { root, paths }),
  gitUnstage: (root: string, paths: string[]) => invoke<void>("git_unstage", { root, paths }),
  gitCommit: (root: string, message: string) => invoke<void>("git_commit", { root, message }),
  /** Pulls and pushes; publishes a branch without remote branch. */
  gitSync: (root: string) => invoke<void>("git_sync", { root }),
  gitFetch: (root: string) => invoke<void>("git_fetch", { root }),
  /** Clones `url` into the new folder `parent/name` and returns it. */
  gitClone: (url: string, parent: string, name: string) => invoke<string>("git_clone", { url, parent, name }),
  /** Name and e-mail Git commits with. Fails without Git. */
  gitIdentity: () => invoke<GitIdentity>("git_identity"),
  gitSetIdentity: (name: string, email: string) => invoke<void>("git_set_identity", { name, email }),
  /** Makes the open project folder a repository; nothing is committed yet. */
  gitInitFolder: (root: string) => invoke<void>("git_init_folder", { root }),
  /** Makes `url` the repository's `origin`. */
  gitSetRemote: (root: string, url: string) => invoke<void>("git_set_remote", { root, url }),
  /** Makes the project a repository with a first commit; `remote` becomes its `origin`. */
  gitInit: (root: string, message: string, remote: string | null) => invoke<void>("git_init", { root, message, remote }),
};
