// The document store: what the ribbon, the editor and the PDF view share for
// the open project. Its tabs and dialogs, the project's files in tabs, syncing
// between source and PDF, and moving headings in the outline. The commands
// that change the document's LaTeX have stores of their own: formatting,
// pageLayout and inserting; building has build.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message, open } from "@tauri-apps/plugin-dialog";
import { api, errorMessage, events, type Engine, type PdfLocation, type ProjectScan, type WindowStart, type WordCount } from "$lib/api";
import { extensionOf, fileKind, validateName, validateRename, VISIBLE_EXTENSIONS } from "$lib/config/project-files";
import type { SpellSetting } from "$lib/config/spelling";
import { template, type TemplateId } from "$lib/config/templates";
import type { LatexEditor } from "$lib/editor/latex-editor";
import { convertFonts, fontModeOf } from "$lib/latex/fonts";
import { type ListKind } from "$lib/latex/lists";
import { OutlineMoveError, planExtract, planMove, type Part } from "$lib/latex/outline-move";
import { packagesEdit, slugOf } from "$lib/latex/preamble";
import { m } from "$lib/paraglide/messages";
import { fileName, isWithin, joinPath, parentDir, relativePath } from "$lib/util/paths";
import { actions } from "./actions.svelte";
import { build } from "./build.svelte";
import { formatting } from "./formatting.svelte";
import { locale } from "./locale.svelte";
import { packages } from "./packages.svelte";
import { panes, popups } from "./panes.svelte";
import { isFolder, project } from "./project.svelte";
import { review } from "./review.svelte";
import { leaveTab } from "./ribbon-choices.svelte";
import { settings } from "./settings.svelte";
import { tabWindows } from "./tab-windows.svelte";

/** texcount reads every included file; once per build is plenty, at most this often. */
const WORD_COUNT_INTERVAL = 10_000;

export type Tab = "file" | "start" | "edit" | "insert" | "layout" | "window";
/** Pages of the "File" tab, which covers the whole window like Word's backstage. */
export type FileSection = "new" | "open" | "print" | "ai" | "settings";
export type SettingsSection = "appearance" | "language" | "units" | "proofing" | "shortcuts" | "project" | "packages" | "updates" | "about";

/**
 * Ties the open project to the editor and the window: the ribbon's tabs and
 * dialogs, opening projects and files in tabs, the files' changes, syncing
 * between source and PDF, and undo across files. Building, formatting, the
 * page layout and inserting have stores of their own (build, formatting,
 * pageLayout, inserting).
 */

class DocumentStore {
  #tab = $state<Tab>("start");

  get tab(): Tab {
    return this.#tab;
  }

  /** The tab left behind puts its choices back to their defaults (see `ribbonChoice`). */
  set tab(tab: Tab) {
    if (tab !== this.#tab) leaveTab(this.#tab);
    this.#tab = tab;
  }

  /** Ribbon tab the "File" tab returns to. */
  returnTab = $state<Exclude<Tab, "file">>("start");
  fileSection = $state<FileSection>("new");
  settingsSection = $state<SettingsSection>("language");
  /** Words of the whole document, from texcount. */
  words = $state<WordCount | null>(null);
  #wordsAt = 0;
  #installedTexcount = false;
  /** Where the PDF view should scroll to; a new object each time, even for the same spot. */
  pdfTarget = $state.raw<PdfLocation | null>(null);
  /** File whose version history is shown, `null` when the dialog is closed. */
  historyFor = $state<string | null>(null);
  /** ZIP being imported; the import dialog is shown while it is set. */
  importArchive = $state<string | null>(null);
  /**
   * The dialog for a project in a Git repository: `"init"` makes a new one, `"clone"` clones one,
   * `"either"` offers both (the start page); `null` while closed.
   */
  gitProject = $state<"init" | "clone" | "either" | null>(null);
  /**
   * The list the lists dialog shows, `null` while closed: a new one (`line`
   * null) or the one the main file prints or reads in at `line`. Without
   * `kind` the dialog picks: the document's first list, else a new one.
   */
  listDialog = $state<{ kind: ListKind | null; line: number | null } | null>(null);
  /** Whether the dialog for inserting an image is shown. */
  imageDialog = $state(false);
  /** Whether the dialog for inserting a table is shown. */
  tableDialog = $state(false);
  /** The link dialog: to a web page or to a place in the document; `null` while closed. */
  linkDialog = $state<"web" | "reference" | null>(null);
  /** Whether the dialog for the page margins is shown. */
  marginsDialog = $state(false);
  /** The citation dialog: citing a source, or adding one; `null` while closed. */
  citationDialog = $state<"cite" | "add" | null>(null);
  /** Whether the symbol dialog (all the characters the distribution sets) is shown. */
  symbolDialog = $state(false);
  /** Whether the project search is shown. */
  /** Whether the dialog for the header and footer (and how the page numbers count) is shown. */
  headerFooterDialog = $state(false);
  /** Whether the dialog for the title, authors and date is shown. */
  titleDialog = $state(false);
  /**
   * Install whatever a build reports missing without asking, like MiKTeX's
   * on-the-fly installation. The packages come from TeX Live, not with
   * Gilgamesh, so only once the user chose it: an older default does not count.
   */
  get autoSave(): boolean {
    return settings.data.autoSave;
  }

  /** Switched on, what is still unsaved is written at once. */
  set autoSave(value: boolean) {
    settings.update({ autoSave: value });
    if (value) void this.save();
  }

  error = $state<string | null>(null);
  /** Files with a tab in the editor, in tab order; the shown one is `shown`. */
  tabs = $state<string[]>([]);
  /** The image shown in the editor's place (see `PROJECT_FILES.viewable`); `project.file` is `null` meanwhile. */
  image = $state<string | null>(null);
  /** The file whose tab is shown: the image, else the editor's file. */
  shown = $derived(this.image ?? project.file);
  /** Set by the editor component once CodeMirror is mounted. */
  editor: LatexEditor | null = null;
  constructor() {
    $effect.root(() => {
      $effect(() => {
        const parts = [this.shown && fileName(this.shown), project.name, "Gilgamesh"].filter(Boolean);
        void getCurrentWindow().setTitle(parts.join(" – "));
      });
    });
    // Autosave is debounced; write the last keystrokes before the window goes away.
    // AI changes awaiting review keep their originals for the next session too.
    void getCurrentWindow().onCloseRequested(() =>
      Promise.all([project.flush(), review.flush()]).then(
        () => {},
        () => {},
      ),
    );
  }

  /** Shows the "File" tab, at `section` if given. */
  showFile(section?: FileSection) {
    if (this.tab !== "file") this.returnTab = this.tab;
    this.tab = "file";
    if (section) this.fileSection = section;
  }

  /** Back from the "File" tab to the ribbon tab shown before. */
  leaveFile() {
    if (this.tab === "file") this.tab = this.returnTab;
  }

  openSettings(section: SettingsSection) {
    this.showFile("settings");
    this.settingsSection = section;
  }

  /** Reopens the last project, if it still exists and no other window shows it. */
  async restore() {
    const last = project.recent[0];
    if (!last || (await api.projectClaim(last))) return;
    try {
      await project.open(last);
      this.#afterOpen();
    } catch {
      project.forget(last);
    }
  }

  /** New projects are made on the "New" page of the File tab. */
  newProject() {
    this.showFile("new");
  }

  /** What a new main window was opened for (see `windowOpenMain`). */
  async start(start: WindowStart) {
    if (start.action === "open") await this.openProject(start.root);
    else if (start.action === "new") this.newProject();
    else this.#askImport(start.archive);
  }

  /** Asks for a ZIP (e.g. an Overleaf download), then for name and location. */
  async importProject() {
    const archive = await this.#chooseArchive();
    if (archive) this.#askImport(archive);
  }

  #chooseArchive() {
    return open({ filters: [{ name: "ZIP", extensions: ["zip"] }], title: m.import_dialog() });
  }

  #askImport(archive: string) {
    this.importArchive = archive;
  }

  /** The same as `openProject`, in another main window. */
  async openProjectInWindow() {
    const root = await open({ directory: true, title: m.project_dialog_open() });
    if (root) await api.windowOpenMain({ action: "open", root }).catch((err) => (this.error = errorMessage(err)));
  }

  /**
   * Unpacks the chosen ZIP into `parent/name` and opens it, here or in a new main
   * window. Errors propagate to the dialog.
   */
  async importInto(parent: string, name: string, inNewWindow = false) {
    const archive = this.importArchive;
    if (!archive) return;
    const root = await api.projectImportZip(archive, parent, validateName(name, "folder"));
    if (inNewWindow) return this.#openInNewWindow(root);
    await api.projectClaim(root);
    await project.open(root);
    this.importArchive = null;
    this.error = null;
    this.#afterOpen();
  }

  /**
   * Creates the folder `parent/name` as a new project and opens it, here or in a
   * new main window. Errors propagate to the "New" page.
   */
  async createProject(parent: string, name: string, templateId: TemplateId, inNewWindow = false) {
    const root = await api.projectCreateRoot(parent, validateName(name, "folder"));
    if (inNewWindow) {
      await project.fill(root, template(templateId, locale.current));
      return this.#openInNewWindow(root);
    }
    await api.projectClaim(root);
    await project.create(root, template(templateId, locale.current));
    this.error = null;
    this.#afterOpen();
  }

  /**
   * Clones the Git repository at `url` into `parent/name` and opens it, here or
   * in a new main window. Errors (Git missing, a wrong link, no access) propagate to the dialog.
   */
  async cloneProject(url: string, parent: string, name: string, inNewWindow = false) {
    const root = await api.gitClone(url, parent, validateName(name, "folder"));
    this.gitProject = null;
    await this.#openCreated(root, inNewWindow);
  }

  /**
   * Creates `parent/name` from a template as a Git repository with a first
   * commit (`message`) and opens it, here or in a new main window. With
   * `remote`, an empty repository on a server, the first state is published
   * there. Returns what went wrong after the project was made (no repository,
   * not published): the project is there and open all the same.
   */
  async createGitProject(
    parent: string,
    name: string,
    templateId: TemplateId,
    message: string,
    remote: string | null,
    inNewWindow = false,
  ): Promise<string | null> {
    const root = await api.projectCreateRoot(parent, validateName(name, "folder"));
    await project.fill(root, template(templateId, locale.current));
    let problem: string | null = null;
    try {
      await api.gitInit(root, message, remote);
      if (remote) await api.gitSync(root);
    } catch (err) {
      problem = errorMessage(err);
    }
    await this.#openCreated(root, inNewWindow);
    return problem;
  }

  async #openCreated(root: string, inNewWindow: boolean) {
    if (inNewWindow) return this.#openInNewWindow(root);
    await api.projectClaim(root);
    await project.open(root);
    this.error = null;
    this.#afterOpen();
  }

  /** A project just made or imported, opened by another main window; this one stays as it is. */
  async #openInNewWindow(root: string) {
    await api.windowOpenMain({ action: "open", root });
    this.importArchive = null;
    this.error = null;
  }

  /** Opens `root`, or asks for a folder. */
  async openProject(root?: string) {
    root ??= (await open({ directory: true, title: m.project_dialog_open() })) ?? undefined;
    if (!root) return;
    // Shown in another window: that one comes to the front instead.
    const previous = project.root;
    if (await api.projectClaim(root)) return;
    if (!(await this.#run(() => project.open(root)))) {
      project.forget(root);
      if (previous) void api.projectClaim(previous);
    }
  }

  /** Opens a file in the editor; closed editor and preview come back with it. */
  /**
   * Shows a file in the editor. It takes the place of the current tab, unless
   * it already has a tab of its own or `newTab` asks for one (see `#placeTab`).
   * Images are shown in the editor's place.
   */
  async openFile(path: string, newTab = false) {
    if (fileKind(path) === "viewable") return this.#openImage(path, newTab);
    const detached = tabWindows.get(path);
    if (detached) {
      await popups.focus(detached.key);
      return;
    }
    panes.show("editor", "pdf");
    const previous = this.shown;
    const opened = await this.guard(async () => {
      await project.openFile(path);
      this.editor?.load(path, project.text);
      // Marks of AI changes left from an earlier session, if any.
      review.restore(path);
      build.showDiagnostics();
    });
    if (opened && project.file === path) {
      this.image = null;
      this.#placeTab(path, previous, newTab);
    }
  }

  /** Shows an image in the editor's place; the file there is saved and put aside, its tab stays. */
  async #openImage(path: string, newTab: boolean) {
    const detached = tabWindows.getImage(path);
    if (detached) {
      await popups.focus(detached.key);
      return;
    }
    panes.show("editor", "pdf");
    const previous = this.shown;
    if (project.file && !(await this.guard(() => project.closeFile()))) return;
    this.editor?.load("", "");
    this.image = path;
    this.#placeTab(path, previous, newTab);
  }

  /** Closes a file's tab; the last one closes the editor as well. */
  async closeTab(path: string) {
    const index = this.tabs.indexOf(path);
    if (index < 0) return;
    const rest = this.tabs.filter((tab) => tab !== path);
    this.tabs = rest;
    if (path !== this.shown) return;
    if (path === this.image) this.image = null;
    if (rest.length > 0) {
      await this.openFile(rest[Math.max(0, index - 1)]);
      return;
    }
    await project.closeFile();
    this.editor?.load("", "");
    panes.close("editor");
  }

  /**
   * Takes a file's tab out of the editor, e.g. because it moves into a window
   * of its own; the editor shows a neighbouring tab, or nothing.
   */
  async releaseTab(path: string) {
    const index = this.tabs.indexOf(path);
    const rest = this.tabs.filter((tab) => tab !== path);
    this.tabs = rest;
    if (path !== this.shown) return;
    if (path === this.image) this.image = null;
    if (rest.length > 0) {
      await this.openFile(rest[Math.max(0, index - 1)]);
      return;
    }
    await project.closeFile();
    this.editor?.load("", "");
  }

  /** The editor showing `path`: a detached file's own, or the main one if it shows the file. */
  editorFor(path: string): LatexEditor | null {
    return tabWindows.get(path)?.editor ?? (project.file === path ? this.editor : null);
  }

  /** Shows `path` (in its window, if detached) and puts the cursor on `line`. */
  async showLine(path: string, line: number) {
    const detached = tabWindows.get(path);
    if (detached) {
      await popups.focus(detached.key);
      detached.editor.goToLine(line);
      return;
    }
    panes.show("editor");
    if (path !== project.file) await this.openFile(path);
    if (project.file === path) this.editor?.goToLine(line);
  }

  /**
   * A file without a tab takes the place of the shown one's, unless `newTab`
   * asks for its own or its type differs from the shown file's (an image
   * beside a `.tex` file, a `.bib` beside a `.tex`): then it comes next to it.
   */
  #placeTab(path: string, previous: string | null, newTab: boolean) {
    if (this.tabs.includes(path)) return;
    const at = previous ? this.tabs.indexOf(previous) : -1;
    if (at < 0) this.tabs = [...this.tabs, path];
    else if (newTab || extensionOf(path) !== extensionOf(previous!)) this.tabs = this.tabs.toSpliced(at + 1, 0, path);
    else this.tabs = this.tabs.with(at, path);
  }

  /** Creates a file and opens it in the editor. Errors propagate to the caller's inline input. */
  async createFile(dir: string, name: string) {
    const path = await project.createFile(dir, name);
    await this.openFile(path);
  }

  createFolder(dir: string, name: string): Promise<string> {
    return project.createFolder(dir, name);
  }

  /** Renames in place. Errors propagate to the caller's inline input. */
  async renameEntry(path: string, name: string): Promise<string> {
    const target = joinPath(parentDir(path), validateRename(path, name, isFolder(path)));
    return this.#moveTo(path, target);
  }

  /** Moves into the folder `dir` ("" for the project root), keeping the name. */
  async moveEntry(path: string, dir: string) {
    const name = fileName(path);
    await this.guard(() => this.#moveTo(path, joinPath(dir, name)));
  }

  /**
   * Copies files dropped from outside into `dir`. Only types the explorer
   * shows are taken; the others are named in the error.
   */
  async importFiles(dir: string, files: { path: string; file: File }[]) {
    const taken = files.filter((f) => fileKind(f.path) !== null);
    const skipped = files.filter((f) => fileKind(f.path) === null).map((f) => fileName(f.path));
    const imported = await this.guard(() => project.importFiles(dir, taken));
    if (imported && skipped.length > 0) {
      this.error = m.error_import_skipped({ names: skipped.join(", "), extensions: VISIBLE_EXTENSIONS });
    }
    if (imported && taken.length > 0) void build.compile();
  }

  async deleteEntry(path: string) {
    const name = fileName(path);
    if (!(await ask(m.delete_confirm({ name }), { title: m.delete_confirm_title(), kind: "warning" }))) return;
    await this.removeEntry(path);
  }

  /** Deletes without asking, e.g. a new file whose content the user rejected. */
  async removeEntry(path: string) {
    const shown = this.shown;
    await this.guard(async () => {
      await project.delete(path);
      review.forget(path);
      await this.#closeGone(path, shown);
    });
    void build.compile();
  }

  /**
   * `path` (a file or folder) was deleted outside Gilgamesh: its tabs close,
   * without saving, which would bring it back.
   */
  async entryGone(path: string) {
    const shown = this.shown;
    project.release(path);
    await this.#closeGone(path, shown);
    await project.refreshTree();
  }

  /** Drops tabs, windows, undo steps and editor states of the deleted `path`. */
  async #closeGone(path: string, shown: string | null) {
    this.editor?.forget(path);
    actions.forget(path);
    tabWindows.forget(path);
    if (this.image && isWithin(this.image, path)) this.image = null;
    const rest = this.tabs.filter((tab) => !isWithin(tab, path));
    const index = shown ? this.tabs.indexOf(shown) : -1;
    this.tabs = rest;
    if (this.shown) return;
    // The shown file was deleted: a neighbouring tab takes its place.
    if (rest.length > 0) await this.openFile(rest[Math.min(Math.max(0, index - 1), rest.length - 1)]);
    else this.editor?.load("", "");
  }

  /**
   * Starts taking over changes to the project from outside Gilgamesh; call
   * once per main window. Returns the stop. Text files changed from outside
   * await review (see `review`); other files only show up in the explorer
   * and the next build.
   */
  listenForChanges(): () => void {
    // One batch after the other, so a later one never overtakes an earlier one.
    let queue: Promise<unknown> = Promise.resolve();
    const listening = events.onProjectChanges(({ external }) => {
      queue = queue
        .then(async () => {
          if (external.length > 0) await review.externalChanged(external);
          else await project.refreshTree();
          build.scheduleCompile();
        })
        .catch(() => {});
    });
    return () => void listening.then((stop) => stop());
  }

  async #moveTo(path: string, target: string): Promise<string> {
    const moved = await project.move(path, target);
    this.editor?.rename(path, moved);
    actions.renamed(path, moved);
    review.renamed(path, moved);
    tabWindows.renamed(path, moved);
    if (this.image && isWithin(this.image, path)) this.image = moved + this.image.slice(path.length);
    this.tabs = this.tabs.map((tab) => (isWithin(tab, path) ? moved + tab.slice(path.length) : tab));
    void build.compile();
    return moved;
  }

  async setMain(path: string) {
    await this.guard(() => project.setMain(path));
    void build.compile();
  }

  async setSpellLanguage(setting: SpellSetting) {
    await this.guard(() => project.setSpellLanguage(setting));
  }

  async setPdfStandard(standard: string | null) {
    await this.guard(() => project.setPdfStandard(standard));
    void build.compile();
  }

  /**
   * Switches the engine. Between pdfLaTeX and XeLaTeX/LuaLaTeX the fonts are
   * set another way: the main file's are rewritten (see `convertFonts`), after
   * a warning of what may change or be lost. `false` where the user declined.
   */
  async setEngine(engine: Engine): Promise<boolean> {
    const from = project.config.engine;
    if (engine === from) return true;
    let switched = false;
    await this.guard(async () => {
      const main = project.config.main;
      const toMode = fontModeOf(engine);
      if (main && fontModeOf(from) !== toMode) {
        const conversion = convertFonts(await project.mainSource(), fontModeOf(from), toMode);
        const text = [toMode === "unicode" ? m.engine_switch_to_unicode() : m.engine_switch_to_pdflatex()];
        if (conversion.lost.length) text.push(m.engine_switch_lost({ fonts: conversion.lost.join(", ") }));
        if (conversion.unsupported.length) text.push(m.engine_switch_unsupported({ packages: conversion.unsupported.join(", ") }));
        text.push(m.engine_switch_question());
        const confirmed = await ask(text.join("\n\n"), {
          title: m.engine_switch_title(),
          kind: "warning",
          okLabel: m.engine_switch_confirm(),
          cancelLabel: m.new_project_cancel(),
        });
        if (!confirmed) return;
        const edit = conversion.edit;
        if (edit) await actions.replaceText("user", main, edit.from, edit.to, edit.insert);
      }
      await project.setEngine(engine);
      switched = true;
      await formatting.refreshMainSource();
      formatting.readCursorFormat();
    });
    if (switched) void build.compile();
    return switched;
  }

  async save() {
    await this.guard(() => project.flush());
  }

  /** Updates the word count; `force` skips the throttle (click in the status bar). */
  async countWords(force = false) {
    const main = project.config.main;
    if (!project.root || !main || (!force && Date.now() - this.#wordsAt < WORD_COUNT_INTERVAL)) return;
    this.#wordsAt = Date.now();
    try {
      let words = await api.wordCount(project.absolute(main), formatting.chapters ? "chapter" : "section");
      // texcount is part of the essentials, but older installations lack it.
      if (words === null && build.autoInstall && !this.#installedTexcount && !packages.busy) {
        this.#installedTexcount = true;
        await packages.install(["texcount"]);
        words = await api.wordCount(project.absolute(main), formatting.chapters ? "chapter" : "section");
      }
      this.words = words;
    } catch {
      // A failed count only hides the number.
    }
  }

  /** Opens a project file at a line, e.g. from the outline, and shows that spot in the PDF. */
  /**
   * Shows `line` of `path` in the editor. The preview follows, as with
   * Ctrl+Alt+J, from `pdfLine` if given, not at all if it is `null`.
   */
  async goToSource(path: string, line: number, pdfLine: number | null = line) {
    await this.showLine(path, line);
    if (pdfLine !== null && this.editorFor(path)) await this.syncToPdf(path, pdfLine);
  }

  /** Opens the source behind a point of the PDF (double click). */
  async syncFromPdf(at: { page: number; x: number; y: number }) {
    const pdfPath = build.lastResult?.pdfPath;
    if (!pdfPath) return;
    await this.guard(async () => {
      const source = await api.synctexEdit(pdfPath, at.page, at.x, at.y);
      if (!source) return;
      const path = source.file === "" ? project.config.main : project.fileFromLog(source.file);
      if (!path) return;
      await this.showLine(path, source.line);
    });
  }

  /** Shows the cursor's line of `file` (the main editor's by default) in the PDF (Ctrl+Alt+J). */
  /** Shows in the preview what `line` of `file` (the cursor's by default) sets. */
  async syncToPdf(file = project.file, line?: number) {
    const pdfPath = build.lastResult?.pdfPath;
    const editor = file ? this.editorFor(file) : null;
    if (!pdfPath || !file || !editor) return;
    line ??= editor.currentLine();
    await this.guard(async () => {
      const at = await api.synctexView(pdfPath, file === project.config.main ? null : project.absolute(file), line);
      if (!at) return;
      panes.show("pdf");
      this.pdfTarget = { ...at };
    });
  }

  /** Puts an old version into the editor; Ctrl+Z brings the current text back. */
  async restoreVersion(path: string, timestamp: number) {
    const root = project.root;
    if (!root) return;
    await this.guard(async () => {
      const text = await api.historyRead(root, path, timestamp);
      await actions.setText("user", path, text);
      this.historyFor = null;
    });
  }

  /** Undo/redo on the timeline of all files (see `actions`); Ctrl+Z / Ctrl+Y, ribbon buttons. */
  undo() {
    if (this.tab !== "file") void actions.undo("user");
  }

  redo() {
    if (this.tab !== "file") void actions.redo("user");
  }

  /** Loads `names` in the main file's preamble where it lacks them; read anew, as the open file may be the main file. */
  async loadPackages(names: string[]) {
    const main = project.config.main;
    const preamble = main ? packagesEdit(await project.mainSource(), names) : null;
    if (main && preamble) await actions.replaceText("user", main, preamble.at, preamble.at, preamble.insert);
  }

  /**
   * The search bar, as Ctrl+F opens it; it searches all files of the project.
   * Without a text file shown, the main file opens for it first.
   */
  async openSearch() {
    const file = project.file ?? project.config.main;
    if (!file) return;
    if (file !== project.file) await this.openFile(file);
    panes.show("editor");
    this.editor?.openSearch();
  }

  /** Shows a search hit: its file opens (or its window comes to the front), the hit is selected, the search bar stays. */
  async showRange(path: string, from: number, to: number) {
    const detached = tabWindows.get(path);
    if (detached) {
      await popups.focus(detached.key);
      detached.editor.select(from, to);
      detached.editor.openSearch(false);
      return;
    }
    panes.show("editor");
    if (path !== project.file) await this.openFile(path);
    if (project.file !== path) return;
    this.editor?.select(from, to);
    this.editor?.openSearch(false);
  }

  /** The selected text of the open file: what a new link shows. */
  selectedText(): string {
    const editor = project.file ? this.editorFor(project.file) : null;
    if (!editor) return "";
    const { from, to } = editor.selection();
    return editor.getText().slice(from, to);
  }

  /**
   * Moves heading `i` of the outline before heading `target` (`outline.length`:
   * behind the last) by moving the line that reads its file in; where the
   * appendix begins, `part` says on which side of it. A warning explains why
   * when it cannot move, e.g. because it shares its file.
   */
  async moveHeading(i: number, target: number, part?: Part) {
    const shown = project.scan?.outline;
    const heading = shown?.[i];
    if (!shown || !heading) return;
    try {
      // The outline as the files are now, which must still be the one the heading was dragged in.
      const scan = await this.rescan();
      if (!sameOutline(shown, scan.outline)) throw new OutlineMoveError("changed", heading.file);
      try {
        await this.#applyMove(i, target, part);
      } catch (err) {
        if (!(err instanceof OutlineMoveError && err.code === "shared")) throw err;
        const extract = await ask(`${moveErrorMessage(err, heading.title)}\n\n${m.outline_extract_question()}`, {
          title: m.outline_move_title(),
          kind: "warning",
          okLabel: m.outline_extract_confirm(),
          cancelLabel: m.new_project_cancel(),
        });
        if (!extract) return;
        await this.#extractHeading(i);
        await this.#applyMove(i, target, part);
      }
    } catch (err) {
      await message(err instanceof OutlineMoveError ? moveErrorMessage(err, heading.title) : errorMessage(err), {
        title: m.outline_move_title(),
        kind: "warning",
      });
    }
  }

  /** Writes pending edits and reads the outline from the files again. */
  async rescan(): Promise<ProjectScan> {
    await project.flush();
    await project.refreshScan();
    if (!project.scan) throw new Error(m.pdf_no_main());
    return project.scan;
  }

  #moveSource() {
    const { scan, root } = project;
    const main = project.config.main;
    if (!scan || !root || !main) throw new Error(m.pdf_no_main());
    const read = async (path: string) => project.textOf(path) ?? (await api.projectRead(root, path));
    return { root, main, scan, source: { outline: scan.outline, inclusions: scan.inclusions, appendix: scan.appendix, main, read } };
  }

  /** Moves heading `i` before heading `target`, as `planMove` plans it. */
  async #applyMove(i: number, target: number, part?: Part) {
    const { source } = this.#moveSource();
    const edits = await planMove(source, i, target, part);
    const pending = edits.find((edit) => review.kindOf(edit.file) !== null);
    if (pending) throw new Error(m.outline_move_review({ file: pending.file }));
    for (const edit of edits) await actions.replaceText("user", edit.file, edit.from, edit.to, edit.insert);
    await this.rescan();
    void build.compile();
  }

  /**
   * Puts heading `i` and what lies below it into a new file named after its
   * title, read in with `\input` where it stood. The file goes next to the one
   * it comes from; out of the main file, into the folder of the main file's
   * other chapters where they share one.
   */
  async #extractHeading(i: number) {
    const { root, main, scan, source } = this.#moveSource();
    const heading = scan.outline[i];
    const siblings = scan.inclusions.filter((inc) => inc.parent === main).map((inc) => parentDir(inc.file));
    const dir =
      heading.file === main && siblings.length && siblings.every((d) => d === siblings[0]) ? siblings[0] : parentDir(heading.file);
    const name = slugOf(heading.title) || "section";
    let path = joinPath(dir, `${name}.tex`);
    for (let n = 2; await api.projectExists(root, path); n++) path = joinPath(dir, `${name}-${n}.tex`);
    const extraction = await planExtract(source, i, relativePath(parentDir(main), path).replace(/\.tex$/, ""));
    if (review.kindOf(extraction.file) !== null) throw new Error(m.outline_move_review({ file: extraction.file }));
    await project.createFile(dir, fileName(path), extraction.content);
    await actions.replaceText("user", extraction.file, extraction.from, extraction.to, extraction.insert);
    // The same headings in the same order, only the extracted ones in their new file.
    const after = await this.rescan();
    if (!sameOutline(scan.outline, after.outline, false) || after.outline[i].file !== path) {
      throw new OutlineMoveError("changed", path);
    }
  }

  /** Opens or creates a project; returns `false` and shows the error if that failed. */
  async #run(action: () => Promise<void>): Promise<boolean> {
    const ok = await this.guard(action);
    if (ok) this.#afterOpen();
    return ok;
  }

  #afterOpen() {
    this.tab = "start";
    this.words = null;
    this.#wordsAt = 0;
    build.reset();
    // Another project: histories of the previous one's files must not leak into it.
    this.editor?.reset();
    actions.reset();
    review.reset();
    // Saved already: opening another project flushes the old one first.
    void tabWindows.closeAll();
    this.image = null;
    this.tabs = project.file ? [project.file] : [];
    this.editor?.load(project.file ?? "", project.text);
    // AI changes the user had not accepted or rejected when the project was last open.
    void review.load();
    void build.compile();
  }

  async guard(action: () => Promise<unknown>): Promise<boolean> {
    try {
      await action();
      this.error = null;
      return true;
    } catch (err) {
      this.error = errorMessage(err);
      return false;
    }
  }
}

/** Whether two outlines list the same headings in the same order; with `places`, also in the same files and lines. */
function sameOutline(a: ProjectScan["outline"], b: ProjectScan["outline"], places = true): boolean {
  return (
    a.length === b.length &&
    a.every((h, k) => h.level === b[k].level && h.title === b[k].title && (!places || (h.file === b[k].file && h.line === b[k].line)))
  );
}

function moveErrorMessage(err: OutlineMoveError, title: string): string {
  switch (err.code) {
    case "shared":
      return m.outline_move_shared({ title, file: err.file });
    case "line":
      return m.outline_move_line({ file: err.file });
    case "twice":
      return m.outline_move_twice({ file: err.file });
    case "nested-include":
      return m.outline_move_nested({ file: err.file });
    case "position":
      return m.outline_move_position();
    case "changed":
      return m.outline_move_changed();
    case "extract":
      return m.outline_extract_failed({ file: err.file });
  }
}

export const doc = new DocumentStore();
