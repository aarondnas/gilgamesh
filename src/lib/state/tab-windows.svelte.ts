// Files in windows of their own, detached from the editor's tabs. Each has
// its own editor and saves on its own (`FileBuffer`); text, undo history and
// cursor move along when a file is detached and docked again, so undo, the
// timeline (`actions`) and jumps from the outline or the PDF keep working.
// Images go into windows of their own too; they only need their path.
import { mount } from "svelte";
import { api } from "$lib/api";
import { fileKind } from "$lib/config/project-files";
import TabWindow from "$lib/components/window/TabWindow.svelte";
import type { LatexEditor } from "$lib/editor/latex-editor";
import { doc } from "./document.svelte";
import { fileEditor, sharedEditor } from "./editor.svelte";
import { popups } from "./panes.svelte";
import { isWithin } from "$lib/util/paths";
import { FileBuffer, project } from "./project.svelte";
import { review } from "./review.svelte";

export interface FileWindow {
  /** The popup's key, also its native window's name. */
  key: string;
  buffer: FileBuffer;
  editor: LatexEditor;
}

/** An image's tab in a window of its own. */
export interface ImageWindow {
  key: string;
  path: string;
}

const DEFAULT_SIZE = { width: 760, height: 900 };

class TabWindows {
  /** Detached files, in the order they were detached. */
  list = $state.raw<FileWindow[]>([]);
  /** Detached images, apart from the text files: they have no editor or buffer. */
  images = $state.raw<ImageWindow[]>([]);
  #next = 1;

  get(path: string): FileWindow | undefined {
    return this.list.find((w) => w.buffer.path === path);
  }

  getImage(path: string): ImageWindow | undefined {
    return this.images.find((w) => w.path === path);
  }

  byKey(key: string): FileWindow | undefined {
    return this.list.find((w) => w.key === key);
  }

  /** Moves a file's tab into a window of its own, or brings that window to the front. */
  async detach(path: string, at?: { x: number; y: number }) {
    const existing = this.get(path) ?? this.getImage(path);
    if (existing) {
      await popups.focus(existing.key);
      return;
    }
    if (fileKind(path) === "viewable") return this.#detachImage(path, at);
    const root = project.root;
    if (!root || fileKind(path) !== "editable") return;
    const main = sharedEditor();
    // Text, undo history and cursor go along; on disk first, so nothing is lost on the way.
    await project.flush();
    const state = main.takeState(path);
    const text = project.textOf(path) ?? state?.doc.toString() ?? (await api.projectRead(root, path));
    await doc.releaseTab(path);

    const buffer = new FileBuffer(path, text);
    const editor = fileEditor(buffer);
    if (state) editor.cache(path, state);
    editor.load(path, text);
    review.restore(path, editor);
    project.buffers.set(path, buffer);
    const window: FileWindow = { key: `tab${this.#next++}`, buffer, editor };
    this.list = [...this.list, window];

    const opened = await popups.open(
      {
        key: window.key,
        boundsKey: "tab",
        defaultSize: DEFAULT_SIZE,
        render: (target) => mount(TabWindow, { target, props: { window } }),
        // The window's own close button: like the tab's cross.
        onClosed: () => void this.close(window.key),
      },
      at,
    );
    if (!opened) await this.dock(window.key);
  }

  async #detachImage(path: string, at?: { x: number; y: number }) {
    await doc.releaseTab(path);
    const window: ImageWindow = { key: `tab${this.#next++}`, path };
    this.images = [...this.images, window];
    const opened = await popups.open(
      {
        key: window.key,
        boundsKey: "tab",
        defaultSize: DEFAULT_SIZE,
        render: (target) => mount(TabWindow, { target, props: { window } }),
        onClosed: () => void this.close(window.key),
      },
      at,
    );
    if (!opened) await this.dock(window.key);
  }

  /** Back into the editor as a tab, with its undo history. */
  async dock(key: string) {
    const image = this.images.find((w) => w.key === key);
    if (image) {
      this.images = this.images.filter((w) => w !== image);
      popups.close(key);
      await doc.openFile(image.path, true);
      return;
    }
    const window = this.byKey(key);
    if (!window) return;
    await this.#release(window);
    popups.close(key);
    await doc.openFile(window.buffer.path, true);
  }

  /** Closes the file; its undo history stays, for when it is opened again. */
  async close(key: string) {
    if (this.images.some((w) => w.key === key)) {
      this.images = this.images.filter((w) => w.key !== key);
      popups.close(key);
      return;
    }
    const window = this.byKey(key);
    if (!window) return;
    await this.#release(window);
    popups.close(key);
  }

  /** Closes every window, e.g. when another project opens. */
  async closeAll() {
    for (const window of [...this.list, ...this.images]) await this.close(window.key);
  }

  /** A file or folder moved: windows of files inside follow. */
  renamed(from: string, to: string) {
    for (const { buffer, editor } of this.list) {
      if (!isWithin(buffer.path, from)) continue;
      const moved = to + buffer.path.slice(from.length);
      project.buffers.delete(buffer.path);
      editor.rename(buffer.path, moved);
      buffer.path = moved;
      project.buffers.set(moved, buffer);
    }
    this.list = [...this.list];
    for (const image of this.images) if (isWithin(image.path, from)) image.path = to + image.path.slice(from.length);
    this.images = [...this.images];
  }

  /** A file or folder was deleted: its windows close without saving. */
  forget(path: string) {
    for (const window of this.list.filter((w) => isWithin(w.buffer.path, path))) {
      window.buffer.cancel();
      project.buffers.delete(window.buffer.path);
      this.list = this.list.filter((w) => w !== window);
      popups.close(window.key);
      window.editor.destroy();
    }
    for (const image of this.images.filter((w) => isWithin(w.path, path))) {
      this.images = this.images.filter((w) => w !== image);
      popups.close(image.key);
    }
  }

  /** Saves, hands the file's state back to the main editor and drops the window's editor. */
  async #release(window: FileWindow) {
    const path = window.buffer.path;
    await window.buffer.flush();
    project.buffers.delete(path);
    this.list = this.list.filter((w) => w !== window);
    const state = window.editor.takeState(path);
    if (state) sharedEditor().cache(path, state);
    window.editor.destroy();
  }
}

export const tabWindows = new TabWindows();
