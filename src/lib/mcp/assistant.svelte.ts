// Tool calls from AI assistants (Claude Desktop, Claude Code, …) connected
// through `gilgamesh --mcp`; see `src-tauri/src/mcp`. They act like the user:
// edits go through the editor, so they show up and Ctrl+Z undoes them.
// Tool names and parameters must match `src-tauri/src/mcp/tools.rs`. Results
// are read by the assistant, not the user, and stay in English.
import { api, errorMessage, events, type Diagnostic, type Engine, type GitFileChange, type McpResult } from "$lib/api";
import { EDITABLE_EXTENSIONS, fileKind } from "$lib/config/project-files";
import { isSpellSetting, SPELL_LANGUAGES } from "$lib/config/spelling";
import { isLocale, type Locale } from "$lib/paraglide/runtime";
import { actions } from "$lib/state/actions.svelte";
import { doc } from "$lib/state/document.svelte";
import { build } from "$lib/state/build.svelte";
import { MAX_EDITOR_ZOOM, MIN_EDITOR_ZOOM, setEditorZoom } from "$lib/state/editor.svelte";
import { locale } from "$lib/state/locale.svelte";
import { review } from "$lib/state/review.svelte";
import { isFolder, PDF_STANDARDS, project } from "$lib/state/project.svelte";
import { packages } from "$lib/state/packages.svelte";
import { settings } from "$lib/state/settings.svelte";
import { isUnit, UNITS, units } from "$lib/state/units.svelte";
import { fileName, joinPath, parentDir, treeFiles } from "$lib/util/paths";
import { hitsIn, patternOf } from "$lib/util/project-search";

/** How assistants appear on the timeline (see `actions`). */
const ACTOR = "assistant";
const MAX_SEARCH_HITS = 200;
/** How long the status bar names the last tool. */
const ACTIVITY_MS = 4000;

class ToolError extends Error {}

/** The tool an assistant used last, for the status bar; `null` after a few seconds. */
class AssistantActivity {
  tool = $state<string | null>(null);
  #timer: ReturnType<typeof setTimeout> | undefined;

  show(tool: string) {
    this.tool = tool;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => (this.tool = null), ACTIVITY_MS);
  }
}

export const assistantActivity = new AssistantActivity();

/** Calls run one after another, so two edits never interleave. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Starts answering tool calls; call once per main window. Calls go to the window used last.
 * Returns the stop: a second listener (e.g. after a hot reload) would run each call twice.
 */
export function startAssistantTools(): () => void {
  const listening = events.onMcpCall((call) => {
    queue = queue.then(async () => {
      assistantActivity.show(call.name);
      const result = await run(call.name, call.arguments ?? {});
      await api.mcpRespond(call.id, result);
    });
  });
  return () => void listening.then((stop) => stop());
}

async function run(name: string, args: Record<string, unknown>): Promise<McpResult> {
  const tool = TOOLS[name];
  if (!tool) return { text: `Unknown tool: ${name}`, isError: true };
  actions.note(ACTOR, name);
  try {
    return { text: await tool(args) };
  } catch (err) {
    return { text: err instanceof ToolError ? err.message : `Failed: ${errorMessage(err)}`, isError: true };
  }
}

const TOOLS: Record<string, (args: Record<string, unknown>) => Promise<string>> = {
  async get_project() {
    const root = requireProject();
    const files = treeFiles(project.tree);
    return [
      `Project folder: ${root}`,
      `Main file: ${project.config.main ?? "(none – set one in the project explorer)"}`,
      `Engine: ${project.config.engine}`,
      `PDF standard: ${project.config.pdfStandard ?? "plain PDF"}`,
      `Open in the editor: ${project.file ?? "(nothing)"}${project.dirty ? " (unsaved changes)" : ""}`,
      `Files (${files.length}):`,
      ...files.map((f) => `  ${f}`),
    ].join("\n");
  },

  async read_file(args) {
    const path = editablePath(args.path);
    const text = await readText(path);
    const width = String(text.split("\n").length).length;
    return text
      .split("\n")
      .map((line, i) => `${String(i + 1).padStart(width)}\t${line}`)
      .join("\n");
  },

  async search(args) {
    requireProject();
    const query = string(args.query, "query");
    const pattern = patternOf({ query, regex: args.regex === true, caseSensitive: args.caseSensitive === true, wholeWord: false });
    if (pattern instanceof Error) throw new ToolError(`Invalid regular expression: ${pattern.message}`);
    if (!pattern) return "No matches.";
    // One line per line with a match, however many it has.
    const lines: string[] = [];
    for (const path of project.textFiles()) {
      let last = 0;
      for (const hit of hitsIn(path, await readText(path), pattern)) {
        if (hit.line === last) continue;
        last = hit.line;
        lines.push(`${path}:${hit.line}: ${hit.text.trim().slice(0, 300)}`);
        if (lines.length >= MAX_SEARCH_HITS) return `${lines.join("\n")}\n(stopped after ${MAX_SEARCH_HITS} matches)`;
      }
    }
    return lines.length > 0 ? lines.join("\n") : "No matches.";
  },

  async get_outline() {
    requireProject();
    await project.refreshScan();
    const scan = project.scan;
    if (!scan) return "The project has not been scanned yet (no main file?).";
    const outline = scan.outline.map((h) => `${"  ".repeat(h.level)}${h.number ? `${h.number} ` : ""}${h.title}  (${h.file}:${h.line})`);
    const labels = scan.labels.map((l) => `  ${l.key}  (${l.file}:${l.line})`);
    const citations = scan.citations.map((c) => `  ${c.key}: ${[c.author, c.title].filter(Boolean).join(" – ")}`);
    return [
      "Outline:",
      ...(outline.length > 0 ? outline : ["  (no headings)"]),
      "",
      `Labels (${labels.length}):`,
      ...labels,
      "",
      `Bibliography entries (${citations.length}):`,
      ...citations,
    ].join("\n");
  },

  async get_problems() {
    requireProject();
    return problems();
  },

  async compile() {
    requireProject();
    if (!project.config.main) throw new ToolError("The project has no main file, so there is nothing to compile.");
    await build.compile();
    return problems();
  },

  async edit_file(args) {
    const path = editablePath(args.path);
    const oldText = string(args.old_text, "old_text");
    const newText = string(args.new_text, "new_text");
    if (oldText === "") throw new ToolError("old_text must not be empty; use write_file for new content.");
    const editor = await openInEditor(path);
    const text = editor.getText();
    const at = text.indexOf(oldText);
    if (at < 0)
      throw new ToolError(`old_text was not found in ${path}. Read the file again; whitespace and line breaks must match exactly.`);
    const count = text.split(oldText).length - 1;
    if (count > 1) throw new ToolError(`old_text occurs ${count} times in ${path}; include more surrounding text so it is unique.`);
    await actions.replaceText(ACTOR, path, at, at + oldText.length, newText);
    review.touch(path);
    const line = text.slice(0, at).split("\n").length;
    return `Edited ${path} at line ${line}. It is in effect now and marked for the user to accept or reject.`;
  },

  async write_file(args) {
    requireProject();
    const path = normalize(string(args.path, "path"));
    const content = string(args.content, "content");
    if (fileKind(path) !== "editable") throw new ToolError(`Only text files (${EDITABLE_EXTENSIONS}) can be written: ${path}`);
    const exists = treeFiles(project.tree).includes(path);
    if (!exists) {
      await createFolders(parentDir(path));
      await doc.createFile(parentDir(path), fileName(path));
      // Rejecting all of its content deletes it again.
      review.markCreated(path);
    }
    await actions.setText(ACTOR, path, content);
    review.touch(path);
    const marked = "It is in effect now and marked for the user to accept or reject.";
    return exists ? `Replaced the content of ${path}. ${marked}` : `Created ${path}. ${marked}`;
  },

  async get_settings() {
    const lines = [
      `language: ${locale.preference ?? "system"} (showing ${locale.current}; available: ${locale.available.join(", ")}, system)`,
      `autoSave: ${doc.autoSave}`,
      `autoCompile: ${build.autoCompile}`,
      `autoInstallPackages: ${build.autoInstall}`,
      `editorZoom: ${settings.data.editorZoom}`,
      `unit: ${units.preference ?? "system"} (showing ${units.current}; choices: system, ${UNITS.join(", ")})`,
    ];
    if (project.root) {
      lines.push(
        "",
        `Project ${project.name}:`,
        `mainFile: ${project.config.main ?? "(none)"}`,
        `engine: ${project.config.engine}`,
        `pdfStandard: ${project.config.pdfStandard ?? "none"} (choices: none, ${PDF_STANDARDS.join(", ")})`,
        `spellLanguage: ${project.config.spellLanguage} (choices: auto, off, ${SPELL_LANGUAGES.join(", ")})`,
      );
    } else {
      lines.push("", "No project is open, so there is no project configuration.");
    }
    return lines.join("\n");
  },

  async update_settings(args) {
    // Checked first, so a bad value changes nothing at all.
    const changes: (() => Promise<unknown> | void)[] = [];
    const done: string[] = [];
    if (args.language !== undefined) {
      const language = string(args.language, "language");
      if (language !== "system" && !isLocale(language)) {
        throw new ToolError(`Unknown language "${language}". Available: ${locale.available.join(", ")}, system.`);
      }
      changes.push(() => locale.set(language === "system" ? null : (language as Locale)));
      done.push(`language: ${language}`);
    }
    for (const key of ["autoSave", "autoCompile", "autoInstallPackages"] as const) {
      if (args[key] === undefined) continue;
      if (typeof args[key] !== "boolean") throw new ToolError(`${key} must be true or false.`);
      const value = args[key];
      changes.push(() => {
        if (key === "autoSave") doc.autoSave = value;
        else if (key === "autoCompile") build.autoCompile = value;
        else build.autoInstall = value;
      });
      done.push(`${key}: ${value}`);
    }
    if (args.editorZoom !== undefined) {
      const zoom = args.editorZoom;
      if (typeof zoom !== "number" || zoom < MIN_EDITOR_ZOOM || zoom > MAX_EDITOR_ZOOM) {
        throw new ToolError(`editorZoom must be a number from ${MIN_EDITOR_ZOOM} to ${MAX_EDITOR_ZOOM}.`);
      }
      changes.push(() => setEditorZoom(zoom, true));
      done.push(`editorZoom: ${zoom}`);
    }
    if (args.unit !== undefined) {
      const unit = string(args.unit, "unit");
      if (unit !== "system" && !isUnit(unit)) throw new ToolError(`unit must be system, ${UNITS.join(", ")}.`);
      changes.push(() => units.set(unit === "system" ? null : unit));
      done.push(`unit: ${unit}`);
    }
    const projectKeys = ["mainFile", "engine", "pdfStandard", "spellLanguage"] as const;
    if (projectKeys.some((key) => args[key] !== undefined)) requireProject();
    if (args.mainFile !== undefined) {
      const main = editablePath(args.mainFile);
      if (!main.endsWith(".tex")) throw new ToolError("The main file must be a .tex file.");
      changes.push(() => doc.setMain(main));
      done.push(`mainFile: ${main}`);
    }
    if (args.engine !== undefined) {
      const engine = string(args.engine, "engine");
      if (!["lualatex", "xelatex", "pdflatex"].includes(engine)) throw new ToolError("engine must be lualatex, xelatex or pdflatex.");
      changes.push(() => doc.setEngine(engine as Engine));
      done.push(`engine: ${engine}`);
    }
    if (args.pdfStandard !== undefined) {
      const standard = string(args.pdfStandard, "pdfStandard");
      if (standard !== "none" && !(PDF_STANDARDS as readonly string[]).includes(standard)) {
        throw new ToolError(`pdfStandard must be none or one of ${PDF_STANDARDS.join(", ")}.`);
      }
      changes.push(() => doc.setPdfStandard(standard === "none" ? null : standard));
      done.push(`pdfStandard: ${standard}`);
    }
    if (args.spellLanguage !== undefined) {
      const spell = string(args.spellLanguage, "spellLanguage");
      if (!isSpellSetting(spell)) throw new ToolError(`spellLanguage must be auto, off or one of ${SPELL_LANGUAGES.join(", ")}.`);
      changes.push(() => doc.setSpellLanguage(spell));
      done.push(`spellLanguage: ${spell}`);
    }
    if (changes.length === 0) throw new ToolError("Nothing to change: give at least one setting.");
    for (const change of changes) await change();
    if (doc.error) throw new ToolError(doc.error);
    return `Changed, effective now: ${done.join(", ")}.`;
  },

  async undo() {
    requireProject();
    const step = await actions.undo(ACTOR);
    if (!step) return "Nothing to undo.";
    return `Undid ${step.actor === ACTOR ? "an assistant's" : "the user's"} edit in ${step.file}. redo brings it back.`;
  },

  async redo() {
    requireProject();
    const step = await actions.redo(ACTOR);
    if (!step) return "Nothing to redo.";
    return `Redid ${step.actor === ACTOR ? "an assistant's" : "the user's"} edit in ${step.file}.`;
  },

  async open_file(args) {
    const path = editablePath(args.path);
    const line = typeof args.line === "number" && args.line >= 1 ? Math.floor(args.line) : 1;
    // A tab of its own, so the user's current tab stays; a detached file's window comes to the front.
    if (!doc.editorFor(path)) await doc.openFile(path, true);
    await doc.goToSource(path, line);
    return `Showing ${path} at line ${line}.`;
  },

  async delete_file(args) {
    const path = editablePath(args.path);
    const last = await readText(path);
    await project.delete(path);
    // Awaits the user's review like an edit: rejecting it brings the file back.
    await review.fileDeleted(path, last);
    review.touch(path);
    void build.compile();
    // A file an assistant made and the user never accepted is simply gone again.
    if (!(path in review.deleted)) return `Deleted ${path}, which an assistant had created; nothing of it awaits review.`;
    return `Deleted ${path} (to the recycle bin). It awaits the user's review; rejecting the deletion restores it.`;
  },

  async rename_file(args) {
    requireProject();
    const from = normalize(string(args.path, "path"));
    const to = normalize(string(args.new_path, "new_path"));
    if (!treeFiles(project.tree).includes(from) && !isFolder(from)) throw new ToolError(`No such file or folder in the project: ${from}.`);
    if (treeFiles(project.tree).includes(to) || isFolder(to)) throw new ToolError(`${to} exists already.`);
    if (from === to) return "Nothing to do: the paths are the same.";
    // First into the target folder (made as needed), then the new name.
    const dir = parentDir(to);
    await createFolders(dir);
    let path = from;
    if (parentDir(from) !== dir) {
      await doc.moveEntry(from, dir);
      path = joinPath(dir, fileName(from));
      if (doc.error) throw new ToolError(doc.error);
    }
    const name = fileName(to);
    if (fileName(path) !== name) path = await doc.renameEntry(path, name);
    review.touch(path);
    return `Moved ${from} to ${path}. References to it (\\input, \\include, \\includegraphics) are unchanged.`;
  },

  async get_review() {
    requireProject();
    const lines: string[] = [];
    for (const [file, sections] of Object.entries(review.files).sort(([a], [b]) => a.localeCompare(b))) {
      const where = sections.map((s) => (s.endLine > s.line ? `${s.line}-${s.endLine}` : `${s.line}`)).join(", ");
      const kind = review.created.has(file) ? "created" : "changed";
      lines.push(`  ${file} (${kind}): ${sections.length} section${sections.length === 1 ? "" : "s"} at line ${where}`);
    }
    for (const file of Object.keys(review.deleted).sort()) lines.push(`  ${file} (deleted)`);
    if (lines.length === 0) return "Nothing awaits review: the user has accepted or rejected all changes.";
    return [`Awaiting the user's review (${review.count}):`, ...lines].join("\n");
  },

  async install_packages(args) {
    requireProject();
    const names = args.names;
    if (!Array.isArray(names) || names.length === 0 || names.some((n) => typeof n !== "string" || !/^[A-Za-z0-9][\w.-]*$/.test(n))) {
      throw new ToolError('names must be a list of TeX Live package names, e.g. ["siunitx"].');
    }
    if (!packages.installed)
      throw new ToolError("Gilgamesh has no TeX distribution installed yet. Ask the user to install it in Settings → Packages.");
    await api.packagesInstall(names as string[]);
    packages.catalogLoaded = false;
    return `Installed ${names.join(", ")}. Compile to use them.`;
  },

  async git_status() {
    const root = requireProject();
    const info = await api.gitInfo(root);
    if (!info.available) return "Git is not installed on this computer.";
    if (!info.repository) return "The project is not a Git repository. The user can initialize one in the Git tab of the explorer.";
    const status = await api.gitStatus(root);
    const sync = status.upstream
      ? `${status.upstream}: ${status.ahead} commit(s) to push, ${status.behind} to pull`
      : status.hasRemote
        ? "not published yet (no remote branch)"
        : "no remote";
    const change = (f: GitFileChange, kind: string | null) => `  ${kind} ${f.original ? `${f.original} -> ` : ""}${f.path}`;
    const staged = status.files.filter((f) => f.staged).map((f) => change(f, f.staged));
    const unstaged = status.files.filter((f) => f.unstaged).map((f) => change(f, f.unstaged));
    return [
      `Repository: ${info.repository.path}`,
      `Branch: ${status.branch ?? "(detached HEAD)"}`,
      `Remote: ${info.repository.remote ?? "(none)"}`,
      `Sync: ${sync}`,
      `Staged (${staged.length}):`,
      ...staged,
      `Not staged (${unstaged.length}):`,
      ...unstaged,
    ].join("\n");
  },

  async git_commit(args) {
    const root = await requireRepository();
    const message = string(args.message, "message").trim();
    if (!message) throw new ToolError("The commit message must not be empty.");
    if (review.count > 0) {
      throw new ToolError(
        `${review.count} change(s) await the user's review (see get_review). Ask the user to accept or reject them first.`,
      );
    }
    await project.flush();
    const status = await api.gitStatus(root);
    const given = args.paths === undefined ? null : args.paths;
    if (given !== null && (!Array.isArray(given) || given.some((p) => typeof p !== "string"))) {
      throw new ToolError("paths must be a list of file paths as git_status lists them.");
    }
    const changed = status.files.filter((f) => f.staged || f.unstaged);
    const files = given === null ? changed : changed.filter((f) => (given as string[]).includes(f.path));
    if (files.length === 0) throw new ToolError("Nothing to commit: no changed files (see git_status).");
    await api.gitStage(
      root,
      files.flatMap((f) => (f.original ? [f.path, f.original] : [f.path])),
    );
    await api.gitCommit(root, message);
    return `Committed ${files.length} file(s): "${message}". git_sync sends it to the server, if the user wants that.`;
  },

  async git_sync() {
    const root = await requireRepository();
    await project.flush();
    await api.gitSync(root);
    const status = await api.gitStatus(root);
    return `Synced ${status.branch ?? ""} with ${status.upstream ?? "the remote"}.`;
  },
};

/** The project folder, if it is a Git repository and Git is installed. */
async function requireRepository(): Promise<string> {
  const root = requireProject();
  const info = await api.gitInfo(root);
  if (!info.available) throw new ToolError("Git is not installed on this computer.");
  if (!info.repository)
    throw new ToolError("The project is not a Git repository. The user can initialize one in the Git tab of the explorer.");
  if (!info.repository.trusted) {
    throw new ToolError(
      "The user has not confirmed yet that they trust this repository, so Git stays off in it (a repository's configuration can make Git run programs). Ask the user to open the Git view in Gilgamesh's explorer and confirm.",
    );
  }
  return root;
}

function requireProject(): string {
  if (!project.root) throw new ToolError("No project is open in Gilgamesh. Ask the user to open one.");
  return project.root;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string") throw new ToolError(`Parameter ${name} must be a string.`);
  return value;
}

/** "./a\\b.tex" and "/a/b.tex" mean "a/b.tex". */
function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "");
}

/** An existing file the editor can open. */
function editablePath(value: unknown): string {
  requireProject();
  const path = normalize(string(value, "path"));
  if (!treeFiles(project.tree).includes(path)) throw new ToolError(`No such file in the project: ${path}. Use get_project to list files.`);
  if (fileKind(path) !== "editable") throw new ToolError(`${path} is not a text file the editor can open.`);
  return path;
}

/** The editor's text for the open file (with unsaved changes), the saved text otherwise. */
async function readText(path: string): Promise<string> {
  return project.textOf(path) ?? api.projectRead(requireProject(), path);
}

/** The editor showing `path`, in a window of its own if detached, else a tab of the editor. */
async function openInEditor(path: string) {
  if (!doc.editorFor(path)) await doc.openFile(path, true);
  const editor = doc.editorFor(path);
  if (!editor) throw new ToolError(`Could not open ${path} in the editor.`);
  return editor;
}

async function createFolders(dir: string) {
  let current = "";
  for (const name of dir.split("/").filter(Boolean)) {
    const next = current ? `${current}/${name}` : name;
    if (!isFolder(next)) await doc.createFolder(current, name);
    current = next;
  }
}

function problems(): string {
  const result = build.lastResult;
  if (build.building) return "A build is still running; ask again in a moment.";
  if (!result) return doc.error ? `Error: ${doc.error}` : "Not compiled yet. Use compile.";
  const where = (d: Diagnostic) => {
    const file = project.fileFromLog(d.file) ?? d.file ?? project.config.main ?? "";
    return d.line ? `${file}:${d.line}` : file;
  };
  const lines = [`Build ${result.status} in ${(result.durationMs / 1000).toFixed(1)} s${result.pdfPath ? ", PDF updated" : ", no PDF"}.`];
  if (doc.error) lines.push(`Error: ${doc.error}`);
  for (const d of result.diagnostics) lines.push(`${d.severity} ${where(d)}: ${d.message}`);
  if (result.missingFiles.length > 0) lines.push(`Missing package files: ${result.missingFiles.join(", ")}`);
  if (result.missingProjectFiles.length > 0) lines.push(`Missing project files: ${result.missingProjectFiles.join(", ")}`);
  if (result.diagnostics.length === 0) lines.push("No errors or warnings.");
  return lines.join("\n");
}
