// Building the document: compiling it (by hand, or a moment after each change),
// the PDF and table of contents of the last build, the problems it reported
// (with warnings the project ignores taken out), and installing the packages
// it found missing.

import { ask } from "@tauri-apps/plugin-dialog";
import { api, errorMessage, type CompileResult, type ContentsEntry, type Diagnostic, type UnsavedFile } from "$lib/api";
import { escapeLine, usedBy, warningKey, type Fix } from "$lib/latex/problems";
import { maskComments } from "$lib/latex/syntax";
import { m } from "$lib/paraglide/messages";
import { actions } from "./actions.svelte";
import { doc } from "./document.svelte";
import { packages } from "./packages.svelte";
import { project } from "./project.svelte";
import { settings } from "./settings.svelte";
import { tabWindows } from "./tab-windows.svelte";

/** How long the text stays unchanged before a build starts on its own. */
const AUTO_COMPILE_DELAY = 700;

class BuildStore {
  autoCompile = $state(true);
  /** Compile only the open chapter (if it is `\include`d) for faster previews. */
  compileCurrentOnly = $state(false);
  get autoInstall(): boolean {
    return settings.data.autoInstallAsked && settings.data.autoInstallPackages;
  }

  set autoInstall(value: boolean) {
    settings.update({ autoInstallPackages: value, autoInstallAsked: true });
  }

  #offeringAutoInstall = false;

  /**
   * Once LaTeX is installed and the user has not yet decided on automatic
   * installation, recommends it, saying that the packages are external; the
   * answer sets the checkbox under Start.
   */
  async offerAutoInstall() {
    if (settings.data.autoInstallAsked || !packages.installed || this.#offeringAutoInstall) return;
    this.#offeringAutoInstall = true;
    try {
      const accepted = await ask(m.auto_install_offer({ tab: m.tab_start(), checkbox: m.ribbon_auto_install() }), {
        title: m.auto_install_offer_title(),
        kind: "info",
        okLabel: m.auto_install_offer_accept(),
        cancelLabel: m.auto_install_offer_decline(),
      });
      this.autoInstall = accepted;
    } finally {
      this.#offeringAutoInstall = false;
    }
  }

  /** The last build; its `diagnostics` without the warnings ignored in this project (see `ignoreWarning`). */
  lastResult = $state<CompileResult | null>(null);
  /** The last build's messages, the ignored warnings among them. */
  #reported = $state.raw<Diagnostic[]>([]);
  /** Whether the last build left anything for the problems panel to list (ignored warnings are not). */
  hasProblems = $derived(
    !!this.lastResult &&
      (this.lastResult.diagnostics.length > 0 || this.lastResult.missingFiles.length > 0 || this.lastResult.missingProjectFiles.length > 0),
  );
  /** The user showed the problems panel (Window > Problems) while it had nothing to list. */
  problemsShownEmpty = $state(false);
  /** Whether the problems panel is shown: with problems, unless hidden; without, only when asked for. */
  problemsVisible = $derived(settings.data.problemsPanel && (this.hasProblems || this.problemsShownEmpty));
  /** How many of the last build's warnings are ignored. */
  ignoredWarnings = $derived(this.#reported.length - (this.lastResult?.diagnostics.length ?? this.#reported.length));
  pdf = $state.raw<ArrayBuffer | null>(null);
  /** The table of contents of the last build with a PDF; empty before. */
  contents = $state.raw<ContentsEntry[]>([]);
  /** Packages installed so far by `installAllMissing`, `null` when it is not running. */
  installAllProgress = $state<number | null>(null);
  #activeBuilds = $state(0);
  #stopInstallAll = false;
  /** Files automatic installation could not resolve; not retried on every keystroke. */
  #autoInstallFailed = new Set<string>();

  building = $derived(this.#activeBuilds > 0);

  #timer: ReturnType<typeof setTimeout> | undefined;

  /** Another project: nothing built for it yet. */
  reset() {
    clearTimeout(this.#timer);
    this.lastResult = null;
    this.#reported = [];
    this.pdf = null;
    this.contents = [];
  }

  onEditorChange(text: string) {
    project.setText(text);
    if (this.autoCompile) this.scheduleCompile();
  }

  scheduleCompile() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.compile(), AUTO_COMPILE_DELAY);
  }

  /**
   * Drops the warnings a package gives as soon as it is loaded while nothing
   * of it is used in the project (see `usedBy`): they come back with the first use.
   */
  async #withoutIdleWarnings(diagnostics: Diagnostic[]): Promise<Diagnostic[]> {
    if (!diagnostics.some((d) => usedBy(d.message))) return diagnostics;
    const texts = (await project.texts()).map(([, text]) => maskComments(text));
    return diagnostics.filter((d) => {
      const use = usedBy(d.message);
      return !use || texts.some((text) => use.test(text));
    });
  }

  #notIgnored(diagnostics: Diagnostic[]): Diagnostic[] {
    const ignored = new Set(project.config.ignoredWarnings);
    return diagnostics.filter((d) => d.severity === "error" || !ignored.has(warningKey(d)));
  }

  /** Hides a warning in this project from now on, also after the next builds; errors cannot be ignored. */
  async ignoreWarning(d: Diagnostic) {
    if (d.severity !== "warning") return;
    const key = warningKey(d);
    if (project.config.ignoredWarnings.includes(key)) return;
    await doc.guard(() => project.setIgnoredWarnings([...project.config.ignoredWarnings, key]));
    // Ignoring the last one hides the panel, not an empty one.
    this.problemsShownEmpty = false;
    this.#applyIgnored();
  }

  /** Window > Problems: shows the panel, also with nothing in it, or hides it until shown again. */
  setProblemsPanel(shown: boolean) {
    this.problemsShownEmpty = shown;
    settings.update({ problemsPanel: shown });
  }

  /** Shows every ignored warning of this project again. */
  async showIgnoredWarnings() {
    await doc.guard(() => project.setIgnoredWarnings([]));
    this.#applyIgnored();
  }

  #applyIgnored() {
    if (!this.lastResult) return;
    this.lastResult = { ...this.lastResult, diagnostics: this.#notIgnored(this.#reported) };
    this.showDiagnostics();
  }

  async compile() {
    clearTimeout(this.#timer);
    const main = project.config.main;
    if (!packages.installed || !project.root || !main) return;
    this.#activeBuilds++;
    try {
      // Included files are read from disk, so they must be current; without autosave the build reads the unsaved texts instead.
      let unsaved: UnsavedFile[] = [];
      if (doc.autoSave) await project.flush();
      else unsaved = await project.unsavedForBuild();
      const includeOnly = this.compileCurrentOnly && project.file ? project.includeOnlyArgument(project.file) : null;
      const result = await api.compile(
        await project.mainSource(),
        project.absolute(main),
        project.config.engine,
        project.config.pdfStandard,
        includeOnly,
        unsaved,
      );
      if (result.status === "cancelled") return;
      this.#reported = await this.#withoutIdleWarnings(result.diagnostics);
      this.lastResult = { ...result, diagnostics: this.#notIgnored(this.#reported) };
      doc.error = null;
      this.showDiagnostics();
      void project.refreshScan();
      void doc.countWords();
      if (result.pdfPath) {
        this.pdf = await api.readBuildFile(result.pdfPath);
        // Numbers and pages for the outline, as the PDF shows them.
        this.contents = await api.buildContents(result.pdfPath).catch(() => this.contents);
      }
      const installable = result.missingFiles.some((file) => !this.#autoInstallFailed.has(file));
      if (this.autoInstall && installable && this.installAllProgress === null && !packages.busy) {
        void this.installAllMissing(true);
      }
    } catch (err) {
      doc.error = errorMessage(err);
    } finally {
      this.#activeBuilds--;
    }
  }

  /** Opens the file a diagnostic points to and jumps to its line. */
  async goToDiagnostic(d: Diagnostic) {
    const path = project.fileFromLog(d.file);
    if (!path) return;
    if (d.line) await doc.showLine(path, d.line);
    else await doc.openFile(path);
  }

  /** The text of the line a message names, as the editor has it; `null` without one. */
  diagnosticLine(d: Diagnostic): string | null {
    const path = project.fileFromLog(d.file);
    const text = path ? project.textOf(path) : null;
    return text !== null && d.line ? (text.split("\n")[d.line - 1] ?? null) : null;
  }

  /** Makes the fix an explanation offers for `d` (see latex/problems.ts), and compiles again. */
  async fixProblem(d: Diagnostic, fix: Fix) {
    await doc.guard(async () => {
      if (fix.kind === "source") {
        doc.citationDialog = "add";
        return;
      }
      if (fix.kind === "engine") {
        await doc.setEngine(fix.engine);
        return;
      }
      if (fix.kind === "package") await doc.loadPackages([fix.name]);
      if (fix.kind === "escape") {
        const path = project.fileFromLog(d.file);
        const root = project.root;
        if (!path || !root || !d.line) return;
        const text = project.textOf(path) ?? (await api.projectRead(root, path));
        const lines = text.split("\n");
        const line = lines[d.line - 1];
        if (line === undefined) return;
        const from = lines.slice(0, d.line - 1).reduce((sum, l) => sum + l.length + 1, 0);
        const fixed = escapeLine(line, fix.char);
        if (fixed !== line) await actions.replaceText("user", path, from, from + line.length, fixed);
      }
      void this.compile();
    });
  }

  /** Installs the package that provides a missing file and recompiles. */
  async installMissing(file: string) {
    const name = await packages.installForFile(file);
    if (name) await this.compile();
    else doc.error = packages.error;
  }

  /**
   * TeX stops at the first missing file, so each build reveals only the next
   * one. Installs and recompiles until nothing is missing, a package cannot be
   * found, or a file is still missing after its package was installed.
   *
   * `automatic` runs after a build without the user asking; files it cannot
   * resolve are remembered and skipped next time, the button still retries them.
   */
  async installAllMissing(automatic = false) {
    if (this.installAllProgress !== null) return;
    this.installAllProgress = 0;
    this.#stopInstallAll = false;
    const attempted = new Set<string>(automatic ? this.#autoInstallFailed : []);
    try {
      while (!this.#stopInstallAll) {
        const next = (this.lastResult?.missingFiles ?? []).filter((file) => !attempted.has(file));
        if (next.length === 0) break;
        for (const file of next) {
          attempted.add(file);
          if (!(await packages.installForFile(file))) {
            doc.error = packages.error;
            if (automatic) this.#autoInstallFailed.add(file);
            return;
          }
          this.installAllProgress++;
          if (this.#stopInstallAll) return;
        }
        await this.compile();
      }
    } finally {
      this.installAllProgress = null;
      // Still missing although its package was installed: do not loop on it.
      if (automatic) for (const file of this.lastResult?.missingFiles ?? []) this.#autoInstallFailed.add(file);
    }
  }

  /** Lets `installAllMissing` finish the current package, then stop. */
  stopInstallAll() {
    this.#stopInstallAll = true;
  }

  showDiagnostics() {
    const diagnostics = this.lastResult?.diagnostics ?? [];
    const of = (file: string | null) => diagnostics.filter((d) => project.fileFromLog(d.file) === file);
    doc.editor?.setDiagnostics(of(project.file));
    for (const { buffer, editor } of tabWindows.list) editor.setDiagnostics(of(buffer.path));
  }
}

export const build = new BuildStore();
