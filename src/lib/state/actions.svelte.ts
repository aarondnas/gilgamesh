// The one way documents change, whoever changes them: the user in the UI, an
// AI assistant over MCP, or any interface added later. Every text change ends
// up as a step on one timeline across all files, so undo and redo walk back
// through time, whichever file and whoever it was, opening that file as needed.
// Typing keeps CodeMirror's fine-grained steps; changes from elsewhere are
// always steps of their own and never merge with the user's typing.
import { api } from "$lib/api";
import { changes } from "./changes.svelte";
import { doc } from "./document.svelte";
import { build } from "./build.svelte";
import { panes } from "./panes.svelte";
import { project } from "./project.svelte";
import { review } from "./review.svelte";
import { tabWindows } from "./tab-windows.svelte";

/** Who acts: `"user"` for the UI, otherwise the interface, e.g. `"assistant"`. */
export type Actor = string;

/** One undoable step: a CodeMirror history event in `file`. */
export interface Step {
  file: string;
  actor: Actor;
  /** The file's undo depth right after the step; identifies it in CodeMirror's history. */
  depth: number;
}

export interface LogEntry {
  at: number;
  actor: Actor;
  action: string;
  file?: string;
}

const MAX_STEPS = 2000;
const MAX_LOG = 500;

class Actions {
  #undo: Step[] = [];
  #redo: Step[] = [];
  canUndo = $state(false);
  canRedo = $state(false);
  /** What happened, newest last; kept for this session. */
  log = $state.raw<LogEntry[]>([]);

  /** Records an action that is not a text change, e.g. an assistant's tool call. */
  note(actor: Actor, action: string, file?: string) {
    this.log = [...this.log.slice(-(MAX_LOG - 1)), { at: Date.now(), actor, action, file }];
  }

  /** From an editor: a new edit in `file` (typing or `replaceText`/`setText`). */
  edited(actor: Actor, depth: number, file: string) {
    if (!file) return;
    const last = this.#undo.at(-1);
    // Keystrokes CodeMirror merges into one step report the same depth.
    if (!last || last.file !== file || last.depth !== depth) {
      this.#undo.push({ file, actor, depth });
      if (this.#undo.length > MAX_STEPS) this.#undo.shift();
      if (actor !== "user") this.note(actor, "edit", file);
    }
    this.#redo = [];
    this.#sync();
  }

  /**
   * Replaces `from`…`to` in `file` (character offsets) as one step of `actor`.
   * An assistant's change is shown in the editor. The app's own (`"user"`,
   * e.g. a package loaded in the main file) leaves the editor as it is, also
   * where `file` is not shown; the explorer shows where it went (see `changes`).
   */
  async replaceText(actor: Actor, file: string, from: number, to: number, text: string) {
    if (actor === "user") {
      const shown = doc.editorFor(file);
      if (shown) shown.replaceRange(from, to, text, actor);
      else if (!(await this.#changeHidden(file, from, to, text))) {
        // Awaiting review (or no editor yet): the change goes through the editor, which marks it against the review.
        const editor = await this.#editorFor(file);
        if (!editor) throw new Error(`Could not open ${file} in the editor.`);
        editor.replaceRange(from, to, text, actor);
      }
      changes.mark(file, (await this.#textOf(file)) ?? "", from);
      return;
    }
    const editor = await this.#editorFor(file, true);
    if (!editor) throw new Error(`Could not open ${file} in the editor.`);
    editor.replaceRange(from, to, text, actor);
  }

  /**
   * Changes `file` while the editor shows another one: in the editor's
   * remembered state of it, so the step can be undone, and on disk. `false`
   * where that cannot be: a review awaits, or there is no editor.
   */
  async #changeHidden(file: string, from: number, to: number, text: string): Promise<boolean> {
    const editor = doc.editor;
    const root = project.root;
    if (!editor || !root || review.kindOf(file) !== null) return false;
    const current = await api.projectRead(root, file);
    await this.#write(root, file, editor.changeHidden(file, current, from, to, text, "user"));
    return true;
  }

  /** Saves a change made while `file` is not shown; the build follows as after typing. */
  async #write(root: string, file: string, text: string) {
    await api.projectWrite(root, file, text);
    project.snapshot(file, text);
    if (build.autoCompile) build.scheduleCompile();
  }

  /** The text of `file` as an editor or the disk has it. */
  async #textOf(file: string): Promise<string | null> {
    const root = project.root;
    return project.textOf(file) ?? (root ? await api.projectRead(root, file).catch(() => null) : null);
  }

  /**
   * Undoes or redoes `step` in its file while the editor shows another one,
   * as `changeHidden` made it; the explorer shows where. `null` if the file is
   * shown or its remembered state is gone, `false` if the step no longer fits.
   */
  async #stepHidden(step: Step, direction: "undo" | "redo"): Promise<boolean | null> {
    const editor = doc.editor;
    const root = project.root;
    if (!editor || !root || doc.editorFor(step.file) || review.kindOf(step.file) !== null) return null;
    const current = await api.projectRead(root, step.file).catch(() => null);
    const history = current === null ? null : editor.hiddenHistory(step.file, current);
    if (current === null || !history) return null;
    if (history.undo !== (direction === "undo" ? step.depth : step.depth - 1)) return false;
    const text = direction === "undo" ? editor.undoHidden(step.file, current) : editor.redoHidden(step.file, current);
    if (text === null) return false;
    await this.#write(root, step.file, text);
    let at = 0;
    while (at < text.length && text.charCodeAt(at) === current.charCodeAt(at)) at++;
    changes.mark(step.file, text, at);
    return true;
  }

  /** Replaces the whole text of `file` as one step of `actor`. */
  async setText(actor: Actor, file: string, text: string) {
    const editor = await this.#editorFor(file, actor !== "user");
    if (!editor) throw new Error(`Could not open ${file} in the editor.`);
    editor.replaceContent(text, actor);
  }

  /** Undoes the newest step of anyone in any file; returns it, or `null` if there is none. */
  async undo(actor: Actor): Promise<Step | null> {
    while (this.#undo.length > 0) {
      const step = this.#undo.pop()!;
      // A file not shown is undone where it is, as it was changed (see `replaceText`).
      const hidden = await this.#stepHidden(step, "undo");
      if (hidden === false) continue;
      const editor = hidden ? null : await this.#editorFor(step.file);
      // Out of step (the file changed on disk, history was dropped): skip it.
      if (!hidden && (!editor || editor.historyDepth().undo !== step.depth || !editor.undo())) continue;
      this.#redo.push(step);
      this.note(actor, "undo", step.file);
      this.#sync();
      return step;
    }
    this.#sync();
    return null;
  }

  /** Redoes the newest undone step; returns it, or `null` if there is none. */
  async redo(actor: Actor): Promise<Step | null> {
    while (this.#redo.length > 0) {
      const step = this.#redo.pop()!;
      const hidden = await this.#stepHidden(step, "redo");
      if (hidden === false) continue;
      const editor = hidden ? null : await this.#editorFor(step.file);
      if (!hidden && (!editor || editor.historyDepth().undo !== step.depth - 1 || !editor.redo())) continue;
      this.#undo.push(step);
      this.note(actor, "redo", step.file);
      this.#sync();
      return step;
    }
    this.#sync();
    return null;
  }

  /** Another project opened: the steps belong to the previous one. */
  reset() {
    this.#undo = [];
    this.#redo = [];
    this.log = [];
    this.#sync();
  }

  /** A file or folder moved; its steps move along. */
  renamed(from: string, to: string) {
    const moved = (s: Step) => (s.file === from || s.file.startsWith(`${from}/`) ? { ...s, file: to + s.file.slice(from.length) } : s);
    this.#undo = this.#undo.map(moved);
    this.#redo = this.#redo.map(moved);
  }

  /** A file or folder was deleted; its steps can no longer be undone. */
  forget(path: string) {
    const kept = (s: Step) => s.file !== path && !s.file.startsWith(`${path}/`);
    this.#undo = this.#undo.filter(kept);
    this.#redo = this.#redo.filter(kept);
    this.#sync();
  }

  /**
   * The editor showing `file`, opened (and made visible) if it is not shown yet;
   * in a tab of its own with `newTab`, so an assistant's edit leaves the user's tab alone.
   */
  async #editorFor(file: string, newTab = false) {
    const detached = tabWindows.get(file);
    if (detached) return detached.editor;
    panes.show("editor");
    if (project.file !== file) await doc.openFile(file, newTab);
    return project.file === file ? doc.editor : null;
  }

  #sync() {
    this.canUndo = this.#undo.length > 0;
    this.canRedo = this.#redo.length > 0;
  }
}

export const actions = new Actions();
