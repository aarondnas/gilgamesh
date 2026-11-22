// The open project: files, structure, AI changes awaiting review and file
// versions (src-tauri/src/commands/project.rs). Paths are relative to the
// project root; the backend rejects anything outside it.
import { invoke } from "@tauri-apps/api/core";

export interface TreeEntry {
  name: string;
  /** Relative to the project root, with `/` separators. */
  path: string;
  isDir: boolean;
  children: TreeEntry[];
}

export interface ProjectScan {
  /**
   * Headings in reading order; level 0 = part … 5 = paragraph. `number` as LaTeX
   * sets it, e.g. "2.1", "A" or "IV"; `null` for `\section*` and the like.
   */
  outline: { level: number; number: string | null; title: string; file: string; line: number }[];
  labels: { key: string; file: string; line: number }[];
  /** `.bib` entries; `year` empty where none is given, `file` the `.bib` file. */
  citations: { key: string; kind: string; title: string; author: string; year: string; file: string }[];
  /** Files pulled in with `\include`, which `\includeonly` can compile alone. */
  includes: string[];
  /** Where each file of the outline is read in (`line` of `parent`), in reading order. */
  inclusions: { file: string; parent: string; line: number; command: "input" | "include" | "subfile" }[];
  /** Where `\appendix` stands, and how many headings come before it; `null` without an appendix. */
  appendix: { file: string; line: number; index: number } | null;
  /** Spelling dictionary for the document's language (from babel/polyglossia). */
  language: string | null;
}

/** How an AI changed a file: its text, or the file as a whole. */
export type ReviewKind = "modified" | "created" | "deleted";

/**
 * A file with AI changes awaiting review, and its text from before them
 * (see `review.rs`): empty for a file the AI created, the last text of one it deleted.
 */
export interface PendingReview {
  file: string;
  original: string;
  kind: ReviewKind;
}

export interface Version {
  /** Unix time in milliseconds; also the version's id. */
  timestamp: number;
  size: number;
}

/** A text file changed outside Gilgamesh, e.g. by an AI agent with its own tools (see `watch.rs`). */
export interface ExternalChange {
  path: string;
  /** `null`: the file was created. */
  original: string | null;
  /** `null`: the file was deleted. */
  text: string | null;
}

export interface ProjectChanges {
  external: ExternalChange[];
  /** Other files and folders changed, created or deleted. */
  other: string[];
}

export const projectApi = {
  /** Creates `parent/name` and returns its path. */
  projectCreateRoot: (parent: string, name: string) => invoke<string>("project_create_root", { parent, name }),
  /** Creates `parent/name` and unpacks the ZIP into it; returns the new root. */
  projectImportZip: (archive: string, parent: string, name: string) => invoke<string>("project_import_zip", { archive, parent, name }),
  projectTree: (root: string) => invoke<TreeEntry[]>("project_tree", { root }),
  projectScan: (root: string, main: string | null) => invoke<ProjectScan>("project_scan", { root, main }),
  /** The BibTeX entry for a DOI or ISBN; errors `not-an-identifier`, `not-found` or the network's message. */
  bibLookup: (id: string) => invoke<string>("bib_lookup", { id }),
  projectExists: (root: string, path: string) => invoke<boolean>("project_exists", { root, path }),
  projectRead: (root: string, path: string) => invoke<string>("project_read", { root, path }),
  projectReadBytes: (root: string, path: string) => invoke<ArrayBuffer>("project_read_bytes", { root, path }),
  projectWrite: (root: string, path: string, contents: string) => invoke<void>("project_write", { root, path, contents }),
  projectCreateFile: (root: string, path: string, contents: string) => invoke<void>("project_create_file", { root, path, contents }),
  projectCreateDir: (root: string, path: string) => invoke<void>("project_create_dir", { root, path }),
  /** Writes a file brought in from outside, creating folders; never overwrites. Returns the path used. */
  projectImportFile: (root: string, path: string, contents: ArrayBuffer) =>
    invoke<string>("project_import_file", new Uint8Array(contents), {
      headers: { root: encodeURIComponent(root), path: encodeURIComponent(path) },
    }),
  /** Renames or moves; never overwrites. */
  projectRename: (root: string, from: string, to: string) => invoke<void>("project_rename", { root, from, to }),
  /** Moves to the system's recycle bin. */
  projectDelete: (root: string, path: string) => invoke<void>("project_delete", { root, path }),

  reviewList: (root: string) => invoke<PendingReview[]>("review_list", { root }),
  reviewSave: (root: string, path: string, original: string, kind: ReviewKind) =>
    invoke<void>("review_save", { root, path, original, kind }),
  reviewRemove: (root: string, path: string) => invoke<void>("review_remove", { root, path }),

  historySnapshot: (root: string, path: string, contents: string) => invoke<void>("history_snapshot", { root, path, contents }),
  historyList: (root: string, path: string) => invoke<Version[]>("history_list", { root, path }),
  historyRead: (root: string, path: string, timestamp: number) => invoke<string>("history_read", { root, path, timestamp }),
};
