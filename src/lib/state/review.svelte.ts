// Changes by AI assistants (or any interface but the user) awaiting review,
// across all files, as in GitHub Copilot. The editor marks them in the text
// (see `editor/ai-review.ts`) and reports here; this keeps the overview for
// the ribbon and the explorer: how many there are, going from one to the next
// (editor and PDF follow), and accepting or rejecting them all at once. A
// file's history records a version only once nothing in it awaits review any
// more, so the versions are the states the user accepted.
//
// Whole files count too. A file the AI created has the empty text as its
// original: rejecting all of it deletes the file again. A file it deleted is
// kept with its last text until the user accepts the deletion or brings the
// file back. Changes come from assistants working through Gilgamesh's tools
// (MCP), and from outside: whatever changes the project's files without
// going through Gilgamesh, an AI agent with its own tools or any other
// program, awaits review too (see `externalChanged` and `watch.rs`).
//
// As in VS Code, a review outlasts the app: each file's original (its text
// before the assistant's edits) is kept for this user in the app's data
// folder (see `review.rs`). When the project opens again, its files with
// changes awaiting review are listed again, and a file shows its marks again
// once it is opened.
import { api, type ExternalChange, type ReviewKind } from "$lib/api";
import { fileKind } from "$lib/config/project-files";
import type { LatexEditor } from "$lib/editor/latex-editor";
import { sectionsBetween, type ReviewSection } from "$lib/editor/ai-review";
import { actions } from "./actions.svelte";
import { doc } from "./document.svelte";
import { build } from "./build.svelte";
import { isWithin, parentDir } from "$lib/util/paths";
import { project } from "./project.svelte";
import { tabWindows } from "./tab-windows.svelte";

export interface ReviewStop {
  file: string;
  line: number;
}

/** Originals change with each of the user's edits outside the sections; saved this long after the last. */
const SAVE_DELAY = 800;
/** How changes from outside appear on the timeline (see `actions`), as those made through the tools. */
const OUTSIDE = "assistant";
/** How long the explorer shows a file as just changed; matches its animations. */
const TOUCH_MS = 1400;

/** How a review ended: the assistant's change kept, the text from before it back, or a deleted file back. */
export type Settlement = "accepted" | "rejected" | "restored";

class Review {
  /** Sections awaiting review, by file; files without any are left out. */
  files = $state.raw<Record<string, ReviewSection[]>>({});
  /** Files the AI created that await review; their sections are in `files`. */
  created = $state.raw<ReadonlySet<string>>(new Set());
  /** Files the AI deleted that await review, with their last text. */
  deleted = $state.raw<Record<string, string>>({});
  /** Files an assistant changed a moment ago (see `touch`). */
  touched = $state.raw<ReadonlySet<string>>(new Set());
  #touchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Files whose review ended a moment ago, and how, so the explorer can show it. */
  settled = $state.raw<ReadonlyMap<string, Settlement>>(new Map());
  #settledTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /**
   * Position in `stops` for the counter ("2 / 5"): the stop shown last by
   * `next`/`previous`, else the first; `null` while nothing awaits review.
   */
  shown = $state<number | null>(null);
  /** Whether `next`/`previous` has gone to `shown` already; until then, `next` goes there. */
  #visited = false;

  /** Each pending file's original, as last saved or about to be. */
  #originals = new Map<string, string>();
  /** Originals not saved yet, with the project they belong to. */
  #unsaved = new Map<string, { root: string; timer: ReturnType<typeof setTimeout> }>();

  /**
   * Everything to go through, in order: files by path, the sections of each
   * from top to bottom. A deleted file is one stop; opened, it shows its last
   * text as one removed section (see `restore`).
   */
  readonly stops: ReviewStop[] = $derived(
    [...new Set([...Object.keys(this.files), ...Object.keys(this.deleted)])]
      .sort((a, b) => a.localeCompare(b))
      .flatMap((file) => this.files[file]?.map((s) => ({ file, line: s.line })) ?? [{ file, line: 1 }]),
  );
  readonly count = $derived(this.stops.length);

  constructor() {
    let previous = 0;
    $effect.root(() => {
      $effect(() => {
        const count = this.count;
        const shown = this.shown;
        // Stops came or went: the one now at the position is where "next" goes.
        if (count !== previous) this.#visited = false;
        previous = count;
        if (count === 0) this.shown = null;
        else if (shown === null) this.shown = 0;
        else if (shown >= count) this.shown = count - 1;
      });
    });
  }

  pending(file: string): boolean {
    return file in this.files;
  }

  /** How the AI changed `file`, `null` if nothing in it awaits review. */
  kindOf(file: string): ReviewKind | null {
    if (file in this.deleted) return "deleted";
    if (!this.pending(file)) return null;
    return this.created.has(file) ? "created" : "modified";
  }

  /**
   * From an editor: the sections of `file` changed, measured against
   * `original`; an empty list (and `null`) once all are settled.
   */
  report(file: string, sections: ReviewSection[], text: string, original: string | null) {
    if (!file) return;
    if (sections.length > 0 && original !== null) {
      this.files = { ...this.files, [file]: sections };
      if (this.#originals.get(file) !== original) {
        this.#originals.set(file, original);
        this.#scheduleSave(file);
      }
    } else if (this.pending(file)) {
      this.#settle(file, text);
    }
  }

  /**
   * An assistant (or a program outside Gilgamesh) just changed, created or
   * deleted `file`: the explorer shows the change arriving for a moment.
   */
  touch(file: string) {
    clearTimeout(this.#touchTimers.get(file));
    this.touched = new Set([...this.touched, file]);
    this.#touchTimers.set(
      file,
      setTimeout(() => {
        this.#touchTimers.delete(file);
        this.touched = new Set([...this.touched].filter((f) => f !== file));
      }, TOUCH_MS),
    );
  }

  /** The review of `file` just ended with `how`; shown in the explorer for a moment. */
  #showSettled(file: string, how: Settlement) {
    clearTimeout(this.#settledTimers.get(file));
    this.settled = new Map([...this.settled, [file, how]]);
    this.#settledTimers.set(
      file,
      setTimeout(() => {
        this.#settledTimers.delete(file);
        this.settled = new Map([...this.settled].filter(([f]) => f !== file));
      }, TOUCH_MS),
    );
  }

  /** An assistant is about to fill the new, empty file `file`: rejecting all of it deletes the file. */
  markCreated(file: string) {
    this.created = new Set([...this.created, file]);
  }

  /**
   * The project opened: lists its files with changes awaiting review from an
   * earlier session, and shows the marks in the file open in the editor.
   */
  async load() {
    const root = project.root;
    if (!root) return;
    const pending = await api.reviewList(root).catch(() => []);
    for (const { file, original, kind } of pending) {
      if (project.root !== root) return;
      const text = project.textOf(file) ?? (await api.projectRead(root, file).catch(() => null));
      if (kind === "deleted") {
        // Back in the meantime: there is no deletion left to review.
        if (text === null) this.deleted = { ...this.deleted, [file]: original };
        else void api.reviewRemove(root, file).catch(() => {});
        continue;
      }
      const sections = text === null ? [] : sectionsBetween(original, text);
      if (sections.length === 0) {
        // Gone, or back to its original: nothing awaits review.
        void api.reviewRemove(root, file).catch(() => {});
        continue;
      }
      if (kind === "created") this.markCreated(file);
      this.#originals.set(file, original);
      this.files = { ...this.files, [file]: sections };
    }
    for (const file of [project.file, ...tabWindows.list.map((w) => w.buffer.path)]) {
      if (file) this.restore(file);
    }
  }

  /**
   * Shows the marks of an earlier session in the editor that just opened
   * `file`. A deleted file is shown empty, with its last text from the
   * review store as original: all of it is one removed section.
   */
  restore(file: string, editor: LatexEditor | null = doc.editorFor(file)) {
    const original = this.#originals.get(file) ?? this.deleted[file];
    if (original === undefined || !editor || editor.reviewSections().length > 0) return;
    if (editor.getText() === original) this.#settle(file, original, false);
    else editor.restoreReview(original);
  }

  /**
   * Files were changed, created or deleted outside Gilgamesh, by an AI agent
   * or any other program: they await review like changes made through the tools.
   */
  async externalChanged(changes: ExternalChange[]) {
    for (const change of changes) {
      if (!project.root || fileKind(change.path) !== "editable") continue;
      this.touch(change.path);
      if (change.text === null) await this.fileDeleted(change.path, change.original ?? "");
      else await this.#changedOutside(change.path, change.original, change.text);
    }
    await project.refreshTree();
  }

  async #changedOutside(file: string, before: string | null, text: string) {
    let original = before;
    if (file in this.deleted) {
      // Deleted, then written again: what matters is the text before the deletion.
      original = this.deleted[file];
      this.#dropDeleted(file);
    } else if (before === null && !this.pending(file)) {
      this.markCreated(file);
    }
    const editor = doc.editorFor(file);
    if (editor) {
      // Shown: the change goes through the editor, which marks it against the text it showed.
      if (editor.getText() !== text) await actions.setText(OUTSIDE, file, text);
      return;
    }
    const base = this.#originals.get(file) ?? original ?? "";
    const sections = sectionsBetween(base, text);
    if (sections.length === 0) {
      if (this.pending(file)) this.#settle(file, text);
      return;
    }
    this.#originals.set(file, base);
    this.files = { ...this.files, [file]: sections };
    this.#scheduleSave(file);
  }

  /**
   * `file` was deleted, by an assistant or outside Gilgamesh, with `last` as its text:
   * it awaits review until the user accepts the deletion or brings the file back.
   */
  async fileDeleted(file: string, last: string) {
    const wasCreated = this.created.has(file);
    const original = this.#originals.get(file) ?? last;
    this.#forgetFile(file);
    await doc.entryGone(file);
    const root = project.root;
    if (!root) return;
    if (wasCreated) {
      // Created and deleted again: nothing of it is left to review.
      void api.reviewRemove(root, file).catch(() => {});
      return;
    }
    this.deleted = { ...this.deleted, [file]: original };
    void api.reviewSave(root, file, original, "deleted").catch(() => {});
  }

  /** Writes originals not saved yet, e.g. before the window closes. */
  flush(): Promise<void> {
    const writes = [...this.#unsaved].map(([file, { root, timer }]) => {
      clearTimeout(timer);
      return this.#save(root, file);
    });
    this.#unsaved.clear();
    return Promise.all(writes).then(() => {});
  }

  /** Goes to the next section after the cursor (wrapping around); editor and PDF show it. */
  next() {
    return this.#go(1);
  }

  previous() {
    return this.#go(-1);
  }

  async #go(direction: 1 | -1) {
    const stops = this.stops;
    if (stops.length === 0) return;
    // The counter names where "next" goes first; after that, each press moves on (wrapping around).
    const shown = this.shown ?? 0;
    const index = this.#visited || direction === -1 ? (shown + direction + stops.length) % stops.length : shown;
    this.shown = index;
    this.#visited = true;
    const stop = stops[index];
    await doc.goToSource(stop.file, stop.line, null);
    // The preview follows only to text it shows: from a line like `\include{…}`,
    // which sets nothing itself, SyncTeX would land on whatever comes after it.
    const lines = doc.editorFor(stop.file)?.getText().split("\n") ?? [];
    const end = this.files[stop.file]?.find((s) => s.line === stop.line)?.endLine ?? stop.line;
    for (let line = stop.line; line <= end; line++) {
      if (!setsText(lines[line - 1] ?? "")) continue;
      await doc.syncToPdf(stop.file, line);
      break;
    }
  }

  /** Accepts everything awaiting review, in every file. */
  async acceptAll() {
    for (const file of Object.keys(this.files)) {
      const shownAlone = file === project.file || tabWindows.get(file);
      const accepted = this.#editorWith(file)?.acceptAllChanges(shownAlone ? undefined : file) ?? false;
      if (accepted) continue;
      // Not open since the restart: the file already holds the assistant's text, which simply stays.
      const root = project.root;
      const text = project.textOf(file) ?? (root ? await api.projectRead(root, file).catch(() => "") : "");
      this.#settle(file, text);
    }
    for (const file of Object.keys(this.deleted)) this.acceptDeletion(file);
    this.shown = null;
    this.#visited = false;
  }

  /** Rejects everything awaiting review, in every file: their earlier text comes back. */
  async rejectAll() {
    for (const file of Object.keys(this.files)) {
      // The text changes, so the file is shown (which restores its marks if need be) and saved.
      const detached = tabWindows.get(file);
      if (!detached && project.file !== file) await doc.openFile(file);
      doc.editorFor(file)?.rejectAllChanges();
    }
    for (const file of Object.keys(this.deleted)) await this.restoreDeleted(file);
    this.shown = null;
    this.#visited = false;
  }

  /** The AI deleted `file`, and so it stays. */
  acceptDeletion(file: string) {
    // Open: the editor accepts its removed section, which settles the file (see `#settle`).
    const editor = doc.editorFor(file);
    if (editor && file in this.files) editor.acceptAllChanges();
    else {
      this.#showSettled(file, "accepted");
      this.#dropDeleted(file);
    }
  }

  /** The AI deleted `file`: it comes back with its last text. */
  async restoreDeleted(file: string) {
    const editor = doc.editorFor(file);
    if (editor && file in this.files) {
      editor.rejectAllChanges();
      return;
    }
    const text = this.deleted[file];
    if (text === undefined) return;
    this.#showSettled(file, "restored");
    await this.#writeBack(file, text);
    this.#dropDeleted(file);
  }

  /** A deleted file is back with `text`: written where it was, with its folders. */
  async #writeBack(file: string, text: string) {
    const root = project.root;
    if (!root) return;
    let folder = "";
    for (const name of parentDir(file).split("/").filter(Boolean)) {
      folder = folder ? `${folder}/${name}` : name;
      if (!(await api.projectExists(root, folder))) await api.projectCreateDir(root, folder);
    }
    await api.projectWrite(root, file, text);
    project.saved(file, text);
    await project.refreshTree();
    void build.compile();
  }

  #dropDeleted(file: string) {
    const { [file]: _, ...rest } = this.deleted;
    this.deleted = rest;
    const root = project.root;
    if (root) void api.reviewRemove(root, file).catch(() => {});
  }

  /** The editor holding `file`'s document: its own window's, or the main one (shown or remembered). */
  #editorWith(file: string): LatexEditor | null {
    return tabWindows.get(file)?.editor ?? doc.editor;
  }

  /** Nothing in `file` awaits review any more: what the user kept is its next version. */
  #settle(file: string, text: string, show = true) {
    // Back to its original text (for a deleted file: its last one), it was rejected.
    const rejected = text === (this.#originals.get(file) ?? this.deleted[file]);
    if (show) this.#showSettled(file, !rejected ? "accepted" : file in this.deleted ? "restored" : "rejected");
    if (file in this.deleted) {
      this.#forgetFile(file);
      // Rejected, the file comes back; accepted, it stays deleted and its tab goes.
      if (text !== "") void this.#writeBack(file, text).then(() => this.#dropDeleted(file));
      else {
        this.#dropDeleted(file);
        // Not while the editor is still reporting the change.
        setTimeout(() => void doc.entryGone(file));
      }
      return;
    }
    const wasCreated = this.created.has(file);
    this.#forgetFile(file);
    const root = project.root;
    if (root) void api.reviewRemove(root, file).catch(() => {});
    // All of a new file rejected: the file goes again, as if the AI had never made it.
    if (wasCreated && text === "") void doc.removeEntry(file);
    else project.snapshot(file, text, true);
  }

  /** Forgets what awaits review in `file` (a deletion apart), without touching the saved originals. */
  #forgetFile(file: string) {
    const { [file]: _, ...rest } = this.files;
    this.files = rest;
    if (this.created.has(file)) this.created = new Set([...this.created].filter((f) => f !== file));
    this.#originals.delete(file);
    clearTimeout(this.#unsaved.get(file)?.timer);
    this.#unsaved.delete(file);
  }

  #scheduleSave(file: string) {
    const root = project.root;
    if (!root) return;
    clearTimeout(this.#unsaved.get(file)?.timer);
    const timer = setTimeout(() => {
      this.#unsaved.delete(file);
      void this.#save(root, file);
    }, SAVE_DELAY);
    this.#unsaved.set(file, { root, timer });
  }

  /** `root` is the project the original belongs to, taken when it was scheduled. */
  #save(root: string, file: string): Promise<void> {
    const original = this.#originals.get(file);
    if (original === undefined) return Promise.resolve();
    const kind = file in this.deleted ? "deleted" : this.created.has(file) ? "created" : "modified";
    return api.reviewSave(root, file, original, kind).catch(() => {});
  }

  /** A file or folder moved; its review moves along (the backend moves the saved originals). */
  renamed(from: string, to: string) {
    const moved = (f: string) => (isWithin(f, from) ? to + f.slice(from.length) : f);
    this.files = Object.fromEntries(Object.entries(this.files).map(([f, s]) => [moved(f), s]));
    this.created = new Set([...this.created].map(moved));
    this.deleted = Object.fromEntries(Object.entries(this.deleted).map(([f, t]) => [moved(f), t]));
    this.#originals = new Map([...this.#originals].map(([f, o]) => [moved(f), o]));
  }

  /** A file or folder was deleted; nothing in it awaits review any more (the backend drops its originals). */
  forget(path: string) {
    const inside = (f: string) => isWithin(f, path);
    this.files = Object.fromEntries(Object.entries(this.files).filter(([f]) => !inside(f)));
    this.created = new Set([...this.created].filter((f) => !inside(f)));
    this.deleted = Object.fromEntries(Object.entries(this.deleted).filter(([f]) => !inside(f)));
    for (const file of [...this.#originals.keys()]) if (inside(file)) this.#originals.delete(file);
    this.shown = null;
    this.#visited = false;
  }

  /** Another project opens; originals not saved yet are written for the previous one first. */
  reset() {
    void this.flush();
    this.files = {};
    this.created = new Set();
    this.deleted = {};
    this.touched = new Set();
    this.settled = new Map();
    this.#originals.clear();
    this.shown = null;
    this.#visited = false;
  }
}

export const review = new Review();

/**
 * Commands that bring in files, load packages, define things or set lengths:
 * they set no text where they stand. Their arguments are no text either.
 */
const SILENT_COMMAND =
  /\\(?:include|input|subfile|includeonly|usepackage|RequirePackage|documentclass|DocumentMetadata|(?:re)?newcommand|providecommand|(?:re)?newenvironment|def|let|newcounter|setcounter|addtocounter|setlength|addtolength|setstretch|label|addbibresource|bibliography|bibliographystyle|printbibliography|definecolor|graphicspath|hypersetup|pagestyle|thispagestyle|pagenumbering|makeatletter|makeatother|lstdefinestyle|DeclareFieldFormat|DeclareNameAlias|DefineBibliographyStrings|crefname|Crefname|input)\b\*?(?:\s*(?:\[[^\]]*\]|\{[^{}]*\}))*/g;

/** Whether `line` sets text the PDF shows, e.g. prose or a heading's title, not just commands. */
function setsText(line: string): boolean {
  const code = line.replace(/(?<!\\)%.*$/, "");
  const rest = code.replace(SILENT_COMMAND, "").replace(/\\[a-zA-Z@]+\*?/g, "");
  return /[\p{L}\p{N}]/u.test(rest);
}
