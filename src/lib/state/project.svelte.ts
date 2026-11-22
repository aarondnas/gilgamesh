// The open project: its folder and file tree, its configuration
// (gilgamesh.json), what a scan found in it, and the buffers of open files.

import { api, type Engine, type ProjectScan, type TreeEntry, type UnsavedFile } from "$lib/api";
import { fileKind, validateName } from "$lib/config/project-files";
import { isSpellSetting, spellLanguageForLocale, type SpellSetting } from "$lib/config/spelling";
import type { Template } from "$lib/config/templates";
import { SvelteMap } from "svelte/reactivity";
import { locale } from "./locale.svelte";
import { review } from "./review.svelte";
import { settings } from "./settings.svelte";
import { m } from "$lib/paraglide/messages";
import { isWithin, joinPath, normalizePath, parentDir, relativePath, treeFiles } from "$lib/util/paths";

const CONFIG_FILE = "gilgamesh.json";
const DEFAULT_MAIN = "main.tex";
const DEFAULT_ENGINE: Engine = "lualatex";
const AUTOSAVE_DELAY = 500;
/** Autosave runs every few hundred ms; history needs far fewer snapshots. */
const SNAPSHOT_INTERVAL = 60_000;
const MAX_RECENT = 5;
const ENGINES: Engine[] = ["lualatex", "xelatex", "pdflatex"];

/** PDF standards offered for `\DocumentMetadata`; the backend accepts the same list. */
export const PDF_STANDARDS = ["A-1b", "A-2b", "A-2u", "A-3b", "A-3u", "A-4", "UA-2"] as const;

export interface ProjectConfig {
  /** File that gets compiled, relative to the project root. */
  main: string | null;
  engine: Engine;
  /** E.g. "A-2b" for PDF/A-2b; `null` for a plain PDF. */
  pdfStandard: string | null;
  spellLanguage: SpellSetting;
  /** Warnings the user chose not to see in this project, by `warningKey`. */
  ignoredWarnings: string[];
}

/**
 * Engine for a project without `gilgamesh.json`. A `% !TEX program = …`
 * comment wins; `inputenc`/`fontenc` mark a document written for pdfLaTeX,
 * where LuaLaTeX would pick other fonts and break lines differently.
 */
function detectEngine(source: string): Engine {
  const magic = /^%\s*!\s*TEX\s+(?:TS-)?program\s*=\s*(\w+)/im.exec(source)?.[1].toLowerCase();
  if (magic && ENGINES.includes(magic as Engine)) return magic as Engine;
  const code = source.replace(/(?<!\\)%.*$/gm, "");
  const uses = (pkg: string) => new RegExp(String.raw`\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\b${pkg}\b`).test(code);
  const unicodeOnly = ["fontspec", "unicode-math", "polyglossia"].some(uses);
  return (uses("inputenc") || uses("fontenc")) && !unicodeOnly ? "pdflatex" : DEFAULT_ENGINE;
}

/**
 * Main file of a folder without `gilgamesh.json` (an imported Overleaf
 * project, a downloaded template): the shallowest `.tex` file with
 * `\documentclass`, `main.tex` first among equals.
 */
async function guessMain(root: string, tree: TreeEntry[]): Promise<{ main: string | null; source: string }> {
  const depth = (p: string) => p.split("/").length;
  const candidates = treeFiles(tree, (p) => p.endsWith(".tex") && depth(p) <= 3);
  candidates.sort((a, b) => depth(a) - depth(b) || Number(!a.endsWith(DEFAULT_MAIN)) - Number(!b.endsWith(DEFAULT_MAIN)));
  for (const path of candidates.slice(0, 40)) {
    const source = await api.projectRead(root, path).catch(() => "");
    if (/^[^%\n]*\\documentclass/m.test(source)) return { main: path, source };
  }
  return { main: candidates[0] ?? null, source: "" };
}

/** Drops files the explorer should not show, see `PROJECT_FILES`. */
function visibleTree(entries: TreeEntry[]): TreeEntry[] {
  return entries
    .filter((e) => e.isDir || fileKind(e.path) !== null)
    .map((e) => (e.isDir ? { ...e, children: visibleTree(e.children) } : e));
}

/** Whether `path` is a folder in the open project's tree. */
export function isFolder(path: string): boolean {
  const find = (entries: TreeEntry[]): TreeEntry | undefined => {
    for (const e of entries) {
      if (e.path === path) return e;
      if (e.isDir && path.startsWith(`${e.path}/`)) return find(e.children);
    }
  };
  return find(project.tree)?.isDir ?? false;
}

/**
 * The open project folder: its file tree, configuration and the file shown in
 * the editor. Edits are written back automatically.
 */
class ProjectStore {
  root = $state<string | null>(null);
  config = $state<ProjectConfig>({ main: null, engine: DEFAULT_ENGINE, pdfStandard: null, spellLanguage: "auto", ignoredWarnings: [] });
  tree = $state.raw<TreeEntry[]>([]);
  /** Outline, labels and bibliography; refreshed after builds and file changes. */
  scan = $state.raw<ProjectScan | null>(null);
  /** File in the editor, relative to the root. */
  file = $state<string | null>(null);
  text = $state("");
  savedText = $state("");
  /** Most recently opened project folders, from the settings file. */
  get recent(): string[] {
    return settings.data.recentProjects;
  }

  name = $derived(this.root?.split(/[\\/]/).filter(Boolean).pop() ?? "");
  /** Dictionary the editor checks with, `null` when off. Without a babel language, the UI language. */
  spellLanguage = $derived(
    this.config.spellLanguage === "off"
      ? null
      : this.config.spellLanguage === "auto"
        ? (this.scan?.language ?? spellLanguageForLocale(locale.current))
        : this.config.spellLanguage,
  );
  dirty = $derived(this.text !== this.savedText);

  #saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** When each file was last snapshotted, see `snapshot`. */
  #snapshotAt = new Map<string, number>();
  #saving: Promise<void> = Promise.resolve();

  /** Opens an existing folder as project. */
  async open(root: string) {
    await this.flush();
    const tree = visibleTree(await api.projectTree(root));
    const config = await this.#readConfig(root, tree);
    this.root = root;
    this.tree = tree;
    this.config = config;
    this.file = null;
    this.text = this.savedText = "";
    this.#remember(root);
    this.scan = null;
    void this.refreshScan();
    if (config.main && treeFiles(tree).includes(config.main)) await this.openFile(config.main);
  }

  /** Fills a new project folder from a template and opens it. */
  async create(root: string, from: Template) {
    await this.fill(root, from);
    await this.open(root);
  }

  /** Fills a new project folder from a template, keeping files that already exist. */
  async fill(root: string, from: Template) {
    const folders = new Set(Object.keys(from.files).map(parentDir).filter(Boolean));
    for (const folder of [...folders].sort()) {
      if (!(await api.projectExists(root, folder))) await api.projectCreateDir(root, folder);
    }
    for (const [path, content] of Object.entries(from.files)) {
      if (!(await api.projectExists(root, path))) await api.projectCreateFile(root, path, content);
    }
    if (!(await api.projectExists(root, CONFIG_FILE))) {
      await this.#writeConfig(root, {
        main: from.main,
        engine: from.engine,
        pdfStandard: from.pdfStandard,
        spellLanguage: "auto",
        ignoredWarnings: [],
      });
    }
  }

  forget(root: string) {
    settings.update({ recentProjects: this.recent.filter((r) => r !== root) });
  }

  async refreshTree() {
    if (this.root) this.tree = visibleTree(await api.projectTree(this.root));
    void this.refreshScan();
  }

  async refreshScan() {
    const root = this.root;
    if (!root) return;
    const scan = await api.projectScan(root, this.config.main).catch(() => null);
    if (this.root === root) this.scan = scan;
  }

  async openFile(path: string) {
    if (!this.root) return;
    await this.flush();
    // Deleted by the AI and not yet reviewed: shown empty, its last text is the review's (see `review`).
    const text = path in review.deleted ? "" : await api.projectRead(this.root, path);
    this.file = path;
    this.text = this.savedText = text;
    // The state before this session's edits.
    this.snapshot(path, text, true);
  }

  /** Shows no file any more, after saving it. */
  async closeFile() {
    await this.flush();
    this.file = null;
    this.text = this.savedText = "";
  }

  setText(text: string) {
    if (!this.file) return;
    this.text = text;
    clearTimeout(this.#saveTimer);
    if (settings.data.autoSave) this.#saveTimer = setTimeout(() => void this.flush().catch(() => {}), AUTOSAVE_DELAY);
  }

  /**
   * Writes pending edits now, of the main editor's file and of files in
   * windows of their own. Writes are serialized, so a slow disk never reorders them.
   */
  flush(): Promise<void> {
    return Promise.all([this.#flushFile(), ...[...this.buffers.values()].map((b) => b.flush())]).then(() => {});
  }

  /** Writes pending edits of the main editor's file. */
  #flushFile(): Promise<void> {
    clearTimeout(this.#saveTimer);
    this.#saving = this.#saving
      .catch(() => {})
      .then(async () => {
        const { root, file, text } = this;
        // A deletion awaiting review is no file to write; `review` writes it back if rejected.
        if (!root || !file || text === this.savedText || file in review.deleted) return;
        await api.projectWrite(root, file, text);
        if (this.root === root && this.file === file) this.savedText = text;
        this.snapshot(file, text);
      });
    return this.#saving;
  }

  /**
   * Gets the edits ready for a build without autosave: the texts the build
   * reads instead of the files on disk, by path from the main file's folder
   * (the main file's own goes as the source). What TeX cannot read that way
   * is saved: bibliographies (Biber reads them itself) and files outside that folder.
   */
  async unsavedForBuild(): Promise<UnsavedFile[]> {
    const base = parentDir(this.config.main ?? "");
    const unsaved: UnsavedFile[] = [];
    const writes: Promise<void>[] = [];
    const take = (file: string, text: string, save: () => Promise<void>) => {
      const path = relativePath(base, file);
      if (file === this.config.main) return;
      if (path.startsWith("../") || file.endsWith(".bib")) writes.push(save());
      else unsaved.push({ path, text });
    };
    if (this.file && this.text !== this.savedText) take(this.file, this.text, () => this.#flushFile());
    for (const buffer of this.buffers.values()) {
      if (buffer.text !== buffer.savedText) take(buffer.path, buffer.text, () => buffer.flush());
    }
    await Promise.all(writes);
    return unsaved;
  }

  /** Whether edits in the main editor or in windows of their own are not written yet. */
  get unsaved(): boolean {
    return this.text !== this.savedText || [...this.buffers.values()].some((b) => b.text !== b.savedText);
  }

  /** Files edited outside the main editor, by path (see `FileBuffer`). */
  buffers = new SvelteMap<string, FileBuffer>();

  /** `text` was just written to `path` by someone else, e.g. `review`: nothing left to save. */
  saved(path: string, text: string) {
    if (this.file === path) this.savedText = text;
    const buffer = this.buffers.get(path);
    if (buffer) buffer.savedText = text;
  }

  /** The current text of `path` where an editor holds it, `null` if only the disk does. */
  textOf(path: string): string | null {
    return this.buffers.get(path)?.text ?? (path === this.file ? this.text : null);
  }

  /** The project's text files (those the editor opens), in the explorer's order. */
  textFiles(): string[] {
    return treeFiles(this.tree).filter((path) => fileKind(path) === "editable");
  }

  /** The project's text files and their texts, as the editors have them where they do, else from disk. */
  async texts(): Promise<[string, string][]> {
    const root = this.root;
    if (!root) return [];
    const texts: [string, string][] = [];
    for (const file of this.textFiles()) {
      const text = this.textOf(file) ?? (await api.projectRead(root, file).catch(() => null));
      if (text !== null) texts.push([file, text]);
    }
    return texts;
  }

  /** Creates a file, empty by default; it becomes the main file if the project has none. */
  async createFile(dir: string, name: string, contents = ""): Promise<string> {
    const root = this.#requireRoot();
    const path = joinPath(dir, validateName(name, "file"));
    await api.projectCreateFile(root, path, contents);
    await this.refreshTree();
    if (!this.config.main && path.endsWith(".tex")) await this.setMain(path);
    return path;
  }

  async createFolder(dir: string, name: string): Promise<string> {
    const root = this.#requireRoot();
    const path = joinPath(dir, validateName(name, "folder"));
    await api.projectCreateDir(root, path);
    await this.refreshTree();
    return path;
  }

  /**
   * Copies files from outside the project into the folder `dir`, keeping
   * their relative paths (`path` may include subfolders of a dropped folder).
   * Taken names get a number. Returns the paths written.
   */
  async importFiles(dir: string, files: { path: string; file: File }[]): Promise<string[]> {
    const root = this.#requireRoot();
    const written: string[] = [];
    try {
      for (const { path, file } of files) {
        written.push(await api.projectImportFile(root, joinPath(dir, path), await file.arrayBuffer()));
      }
    } finally {
      await this.refreshTree();
    }
    return written;
  }

  /**
   * Renames or moves a file or folder and carries the open file and the main
   * file along. Returns the new path. `\input` references in documents are
   * not rewritten.
   */
  async move(from: string, to: string): Promise<string> {
    const root = this.#requireRoot();
    if (from === to) return to;
    if (this.file && isWithin(this.file, from)) await this.flush();
    await api.projectRename(root, from, to);
    const moved = (path: string) => (isWithin(path, from) ? to + path.slice(from.length) : path);
    if (this.file) this.file = moved(this.file);
    if (this.config.main && isWithin(this.config.main, from)) {
      this.config.main = moved(this.config.main);
      await this.#writeConfig(root, this.config);
    }
    await this.refreshTree();
    return to;
  }

  /** Moves a file or folder to the recycle bin; closes it if it was open. */
  async delete(path: string) {
    const root = this.#requireRoot();
    this.release(path);
    await api.projectDelete(root, path);
    if (this.config.main && isWithin(this.config.main, path)) {
      this.config.main = null;
      await this.#writeConfig(root, this.config);
    }
    await this.refreshTree();
  }

  /** Closes the open file if it lies in `path`, which is (about to be) gone, without saving it. */
  release(path: string) {
    if (!this.file || !isWithin(this.file, path)) return;
    clearTimeout(this.#saveTimer);
    this.file = null;
    this.text = this.savedText = "";
  }

  async setMain(path: string) {
    this.config.main = path;
    await this.#writeConfig(this.#requireRoot(), this.config);
  }

  async setSpellLanguage(setting: SpellSetting) {
    this.config.spellLanguage = setting;
    await this.#writeConfig(this.#requireRoot(), this.config);
  }

  /** The warnings by `warningKey` not to show in this project. */
  async setIgnoredWarnings(keys: string[]) {
    this.config.ignoredWarnings = keys;
    await this.#writeConfig(this.#requireRoot(), this.config);
  }

  async setPdfStandard(standard: string | null) {
    this.config.pdfStandard = standard;
    await this.#writeConfig(this.#requireRoot(), this.config);
  }

  /**
   * `\includeonly` argument for compiling just `file`: its path relative to
   * the main file's folder without `.tex`. `null` unless `\include`d.
   */
  includeOnlyArgument(file: string): string | null {
    const main = this.config.main;
    if (!main || file === main || !this.scan?.includes.includes(file)) return null;
    const base = parentDir(main);
    const relative = base && file.startsWith(`${base}/`) ? file.slice(base.length + 1) : file;
    return relative.replace(/\.tex$/, "");
  }

  async setEngine(engine: Engine) {
    this.config.engine = engine;
    await this.#writeConfig(this.#requireRoot(), this.config);
  }

  /** Main file content, taken from the editor if it is open there. */
  async mainSource(): Promise<string> {
    const { root, config } = this;
    if (!root || !config.main) throw new Error(m.pdf_no_main());
    return this.textOf(config.main) ?? api.projectRead(root, config.main);
  }

  /** Absolute path of a project file, with the root's separator style. */
  absolute(path: string): string {
    const root = this.#requireRoot();
    const sep = root.includes("\\") ? "\\" : "/";
    return `${root.replace(/[\\/]+$/, "")}${sep}${path.replaceAll("/", sep)}`;
  }

  /**
   * Maps a file name from the TeX log to a project path. `null` stands for
   * the main file; names are relative to the main file's folder. Returns
   * `null` for files outside the project, e.g. package sources.
   */
  fileFromLog(file: string | null): string | null {
    const { root, config } = this;
    if (!root || !config.main) return null;
    if (file === null) return config.main;
    const normalizedRoot = root.replaceAll("\\", "/").replace(/\/+$/, "");
    const unified = file.replaceAll("\\", "/");
    if (/^([a-zA-Z]:)?\//.test(unified)) {
      return unified.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)
        ? normalizePath(unified.slice(normalizedRoot.length + 1))
        : null;
    }
    return normalizePath(joinPath(parentDir(config.main), unified));
  }

  /** Records a version for the history; throttled unless `now`. Failures only cost history. */
  /** Keeps a version for the history, at most every few minutes unless `now`. */
  snapshot(file: string, text: string, now = false) {
    // An assistant's changes are not a version until the user accepted them (see `review`).
    if (review.pending(file) || file in review.deleted) return;
    const root = this.root;
    const last = this.#snapshotAt.get(file) ?? 0;
    if (!root || (!now && Date.now() - last < SNAPSHOT_INTERVAL)) return;
    this.#snapshotAt.set(file, Date.now());
    void api.historySnapshot(root, file, text).catch(() => {});
  }

  #requireRoot(): string {
    if (!this.root) throw new Error("No project open");
    return this.root;
  }

  #remember(root: string) {
    settings.update({ recentProjects: [root, ...this.recent.filter((r) => r !== root)].slice(0, MAX_RECENT) });
  }

  async #readConfig(root: string, tree: TreeEntry[]): Promise<ProjectConfig> {
    try {
      const raw = JSON.parse(await api.projectRead(root, CONFIG_FILE)) as Partial<ProjectConfig>;
      return {
        main: typeof raw.main === "string" ? raw.main : null,
        engine: ENGINES.includes(raw.engine as Engine) ? (raw.engine as Engine) : DEFAULT_ENGINE,
        pdfStandard: PDF_STANDARDS.includes(raw.pdfStandard as never) ? (raw.pdfStandard as string) : null,
        spellLanguage: isSpellSetting(raw.spellLanguage) ? raw.spellLanguage : "auto",
        ignoredWarnings: Array.isArray(raw.ignoredWarnings) ? raw.ignoredWarnings.filter((k) => typeof k === "string") : [],
      };
    } catch {
      // Plain folder without config: guess the main file, write nothing until the user changes something.
      const { main, source } = await guessMain(root, tree);
      return { main, engine: detectEngine(source), pdfStandard: null, spellLanguage: "auto", ignoredWarnings: [] };
    }
  }

  async #writeConfig(root: string, config: ProjectConfig) {
    await api.projectWrite(root, CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
  }
}

export const project = new ProjectStore();

/**
 * A file shown outside the main editor, in a window of its own: its text,
 * saved shortly after each change like the main editor's file.
 */
export class FileBuffer {
  path: string;
  text = $state("");
  savedText = $state("");
  /** The project the file belongs to; never written into another one. */
  readonly root: string | null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #saving: Promise<void> = Promise.resolve();

  constructor(path: string, text: string) {
    this.path = path;
    this.text = this.savedText = text;
    this.root = project.root;
  }

  setText(text: string) {
    this.text = text;
    clearTimeout(this.#timer);
    if (settings.data.autoSave) this.#timer = setTimeout(() => void this.flush().catch(() => {}), AUTOSAVE_DELAY);
  }

  flush(): Promise<void> {
    clearTimeout(this.#timer);
    this.#saving = this.#saving
      .catch(() => {})
      .then(async () => {
        const { path, text, root } = this;
        if (!root || root !== project.root || text === this.savedText || path in review.deleted) return;
        await api.projectWrite(root, path, text);
        this.savedText = text;
        project.snapshot(path, text);
      });
    return this.#saving;
  }

  /** Stops a pending save, e.g. because the file was deleted. */
  cancel() {
    clearTimeout(this.#timer);
  }
}
