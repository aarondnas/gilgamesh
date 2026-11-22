// What the ribbon's Insert tab puts into the document: links and references,
// symbols, notes, figures and tables, lists of items, page breaks, citations
// and sources, footnotes, formulas, and lists such as the list of figures.

import { api, errorMessage, type ProjectScan } from "$lib/api";
import { validateName } from "$lib/config/project-files";
import { BulletError, bulletBlock, itemsOf, switchesList, switchList, type BulletKind } from "$lib/latex/bullets";
import {
  bibSetupOf,
  citeCode,
  entryKey,
  formatEntry,
  parseEntry,
  setupEdits,
  styleEdits,
  uniqueKey,
  type BibSetup,
  type CiteForm,
} from "$lib/latex/citations";
import { figureCode, type Figure } from "$lib/latex/figures";
import { fontModeOf } from "$lib/latex/fonts";
import { type FormatEdit } from "$lib/latex/format";
import { footnoteEdit } from "$lib/latex/headings";
import { headingLabelEdit, linkTargets, referenceCode, webLinkCode, type LinkTarget, type ReferenceStyle } from "$lib/latex/links";
import {
  ListError,
  listContext,
  listEditContext,
  planList,
  planListEdit,
  planListRemoval,
  printedLists,
  type ListContext,
  type ListEditContext,
  type ListKind,
  type PrintedList,
} from "$lib/latex/lists";
import {
  formulaBlock,
  inlineFormulaEdit,
  structureEdit,
  templateBlock,
  templateEdit,
  type FormulaKind,
  type FormulaTemplate,
  type StructureKind,
} from "$lib/latex/math";
import { NOTE, noteEdit, notesHiddenEdits, notesStyleEdits } from "$lib/latex/notes";
import { bodyLines } from "$lib/latex/page-numbers";
import { labelFrom, packagesEdit, uniqueLabel } from "$lib/latex/preamble";
import { charSymbolEdit, hasCyrillicText, symbolEdit, symbolFontEdit, type CharSymbol, type TextSymbol } from "$lib/latex/symbols";
import { indentOf, maskComments } from "$lib/latex/syntax";
import { tableCode, tableNumberAt, tablePackages, type Table } from "$lib/latex/tables";
import { m } from "$lib/paraglide/messages";
import { fileName, joinPath, parentDir, relativePath, treeFiles } from "$lib/util/paths";
import { actions } from "./actions.svelte";
import { build } from "./build.svelte";
import { doc } from "./document.svelte";
import { formatting } from "./formatting.svelte";
import { pageLayout } from "./page-layout.svelte";
import { project } from "./project.svelte";

class InsertingStore {
  /** Puts a link to `url` at the cursor of the open file, in place of the selection; loads hyperref. Errors propagate to the dialog. */
  async insertWebLink(url: string, text: string) {
    await this.#insertLink(webLinkCode(url, text));
    void build.compile();
  }

  /** Headings, figures, tables and equations a reference can point to, from the files as they are now. */
  async linkTargets(): Promise<LinkTarget[]> {
    const scan = await doc.rescan();
    const { read } = await this.#listSource();
    return linkTargets(scan, read);
  }

  /**
   * Puts a reference to `target` at the cursor of the open file, in place of
   * the selection; a heading without a label gets one first. Loads hyperref.
   * Errors propagate to the dialog.
   */
  async insertReference(target: LinkTarget, style: ReferenceStyle, text: string) {
    const key = target.key ?? target.newLabel;
    if (!key) throw new Error(m.link_no_target());
    await this.#insertLink(referenceCode(key, style, text, await project.mainSource()));
    if (target.key === null) {
      // Read after the reference went in: the heading may be in the open file.
      const { read } = await this.#listSource();
      const source = await read(target.file);
      const edit = headingLabelEdit(source, target.line, key);
      if (!edit) throw new Error(m.link_heading_changed({ title: target.title }));
      await actions.replaceText("user", target.file, edit.at, edit.at, edit.insert);
      await doc.rescan();
    }
    void build.compile();
  }

  async #insertLink(code: string) {
    const editor = project.file ? doc.editorFor(project.file) : null;
    const main = project.config.main;
    if (!editor || !main) throw new Error(m.link_no_file());
    const { from, to } = editor.selection();
    editor.format({ from, to, insert: code, select: { anchor: code.length, head: code.length } });
    // Read after the link went in: the open file may be the main file.
    const preamble = packagesEdit(await project.mainSource(), ["hyperref"]);
    if (preamble) await actions.replaceText("user", main, preamble.at, preamble.at, preamble.insert);
  }

  /** A character of running text (€, §, „…“) in place of the selection, with the package it needs. */
  async insertSymbol(symbol: TextSymbol) {
    const editor = project.file ? doc.editorFor(project.file) : null;
    if (!editor) return;
    const { from, to } = editor.selection();
    editor.format(symbolEdit(editor.getText(), from, to, symbol));
    if (symbol.packages.length) await doc.guard(() => doc.loadPackages(symbol.packages));
  }

  /**
   * A character of the symbol dialog in place of the selection: its command in
   * math, else as text as the engine sets it, with what that needs in the
   * preamble (packages, the fallback font).
   */
  async insertCharSymbol(symbol: CharSymbol) {
    const editor = project.file ? doc.editorFor(project.file) : null;
    const main = project.config.main;
    if (!editor) return;
    const cyrillic = main ? hasCyrillicText(await project.mainSource()) : false;
    const { from, to } = editor.selection();
    const { edit, packages, setup } = charSymbolEdit(editor.getText(), from, to, symbol, fontModeOf(project.config.engine), cyrillic);
    editor.format(edit);
    const needed = setup === "symbolfont" ? [...packages, "fontspec"] : packages;
    if (!main || !needed.length) return;
    await doc.guard(async () => {
      // Read after each edit went in: the open file may be the main file.
      const preamble = packagesEdit(await project.mainSource(), needed);
      if (preamble) await actions.replaceText("user", main, preamble.at, preamble.at, preamble.insert);
      const font = setup === "symbolfont" ? symbolFontEdit(await project.mainSource()) : null;
      if (font) await actions.replaceText("user", main, font.at, font.at, font.insert);
    });
  }

  /** A note for revising after the selection or at the cursor: in the margin, or in the text. Loads todonotes. */
  async insertNote(inline: boolean) {
    const editor = project.file ? doc.editorFor(project.file) : null;
    if (!editor) return;
    const { from, to } = editor.selection();
    editor.format(noteEdit(editor.getText(), from, to, inline));
    await doc.guard(() => this.#loadNotes());
    await formatting.refreshMainSource();
  }

  /** todonotes, and the look of the notes where the document has none of its own (see `notesStyleEdits`). */
  async #loadNotes() {
    await doc.loadPackages(["todonotes"]);
    const main = project.config.main;
    if (!main) return;
    for (const edit of notesStyleEdits(await project.mainSource()))
      await actions.replaceText("user", main, edit.from, edit.to, edit.insert);
  }

  /** Hides all notes, as for handing the work in, or shows them again (todonotes' `disable`). */
  async setNotesHidden(hidden: boolean) {
    await doc.guard(async () => {
      const main = project.config.main;
      if (!main) throw new Error(m.page_setup_no_document());
      await this.#loadNotes();
      for (const edit of notesHiddenEdits(await project.mainSource(), hidden))
        await actions.replaceText("user", main, edit.from, edit.to, edit.insert);
      await formatting.refreshMainSource();
      void build.compile();
    });
  }

  /** Goes to the next note after the cursor in reading order, from the start again after the last. */
  async nextNote() {
    await doc.guard(async () => {
      const { main, texts } = await pageLayout.pageRegions();
      const scan = project.scan;
      const lines = bodyLines(main, (file) => texts.get(file) ?? null, scan?.inclusions ?? []);
      const notes = lines.filter((l) => NOTE.test(maskComments(l.text)));
      if (!notes.length) throw new Error(m.notes_none());
      const file = project.file;
      const editor = file ? doc.editorFor(file) : null;
      const here = editor ? lines.findIndex((l) => l.file === file && l.line === editor.currentLine()) : -1;
      const next = notes.find((n) => lines.indexOf(n) > here) ?? notes[0];
      await doc.goToSource(next.file, next.line);
    });
  }

  /**
   * Puts a figure with the project file `figure.image` at the cursor of the open
   * file and loads graphicx in the main file where it is missing. Errors
   * propagate to the dialog.
   */
  async insertFigure(figure: Figure) {
    await this.#insertBlock(m.image_no_file(), ["graphicx"], (main, mainSource, indent) => ({
      code: figureCode({ ...figure, image: relativePath(parentDir(main), figure.image) }, mainSource, indent),
    }));
  }

  /** Puts a table at the cursor of the open file, with the packages it needs. Errors propagate to the dialog. */
  async insertTable(table: Table) {
    await this.#insertBlock(m.table_no_file(), tablePackages(table), (_, mainSource, indent) => tableCode(table, mainSource, indent));
  }

  /**
   * The ribbon's quick table, as in Word: `rows` in all, the first a header
   * row when there are two or more; booktabs, without caption or label.
   */
  async insertQuickTable(columns: number, rows: number) {
    await doc.guard(() =>
      this.insertTable({
        columns,
        rows: Math.max(1, rows - 1),
        header: rows > 1,
        style: "booktabs",
        fullWidth: false,
        caption: "",
        label: "",
        headerText: (column) => m.table_column({ number: column }),
      }),
    );
  }

  /**
   * Puts a formula at the cursor of the open file, around the selected text:
   * inline in `$…$`, or on lines of its own. Loads what it needs in the main file.
   */
  /**
   * The list buttons, as in Word: in a list, bullets and numbers make it that
   * kind. Elsewhere, and for a list with levels also in a list (a level
   * below), a new list goes in at the cursor, with the selected paragraphs as
   * its items.
   */
  async insertBullets(kind: BulletKind) {
    const editor = project.file ? doc.editorFor(project.file) : null;
    if (!editor) return;
    const text = editor.getText();
    const { from, to } = editor.selection();
    if (switchesList(text, from, kind)) {
      const edit = switchList(text, from, to, kind);
      if (edit) editor.format(edit);
      return;
    }
    let items: string[];
    try {
      items = itemsOf(text.slice(from, to));
    } catch (err) {
      if (!(err instanceof BulletError)) throw err;
      doc.error = m.bullets_selection();
      return;
    }
    await doc.guard(() => this.#insertBlock(m.bullets_no_file(), [], (_, __, indent) => bulletBlock(kind, items, indent)));
  }

  /**
   * Starts a new page at the cursor of the open file, on a line of its own:
   * `\clearpage`, which also sets the figures and tables before it first, as
   * a page break in Word keeps them above it.
   */
  async insertPageBreak() {
    await doc.guard(() => this.#insertBlock(m.page_break_no_file(), [], () => ({ code: "\\clearpage" })));
  }

  /**
   * The bibliography the main file sets up, the project's sources, and the
   * `.bib` file new ones go into: the first the document reads, else the
   * project's first, else a new one beside the main file.
   */
  async citationState(): Promise<{ setup: BibSetup; sources: ProjectScan["citations"]; bib: string }> {
    const main = project.config.main;
    if (!main) throw new Error(m.cite_no_document());
    const source = await project.mainSource();
    const setup = bibSetupOf(source);
    const scan = await doc.rescan();
    return { setup, sources: scan.citations, bib: this.#bibFile(main, setup) };
  }

  #bibFile(main: string, setup: BibSetup): string {
    if (setup.files.length) return joinPath(parentDir(main), setup.files[0]).replace(/^\.\//, "");
    return treeFiles(project.tree, (path) => path.endsWith(".bib"))[0] ?? joinPath(parentDir(main), `${m.lists_bib_file()}.bib`);
  }

  /** biblatex with the `.bib` file `bib` in a main file that has no bibliography tool yet, and the file where it is missing. */
  async #setUpBibliography(main: string, bib: string) {
    const source = await project.mainSource();
    if (bibSetupOf(source).tool !== "none") return;
    const edits = setupEdits(source, relativePath(parentDir(main), bib));
    if (!edits.length) throw new Error(m.cite_no_document());
    for (const edit of edits) await actions.replaceText("user", main, edit.from, edit.to, edit.insert);
    const root = project.root;
    if (root && !(await api.projectExists(root, bib))) await project.createFile(parentDir(bib), fileName(bib));
  }

  /**
   * Cites `keys` at the cursor of the open file (see `citeCode`), setting
   * biblatex up first where the document has no bibliography tool. Errors
   * propagate to the dialog.
   */
  async insertCitation(keys: string[], form: CiteForm, before: string, after: string) {
    const editor = project.file ? doc.editorFor(project.file) : null;
    const main = project.config.main;
    if (!editor || !main) throw new Error(m.cite_no_document());
    const setup = bibSetupOf(await project.mainSource());
    const code = citeCode(setup.tool === "none" ? "biblatex" : setup.tool, form, keys, before, after);
    const { to } = editor.selection();
    // A footnote's mark goes right after the word, as `\footnote` does.
    let at = to;
    const text = editor.getText();
    if (form === "foot") while (at > 0 && text[at - 1] === " ") at--;
    editor.format({ from: at, to, insert: code, select: { anchor: code.length, head: code.length } });
    // After the citation went in: the open file may be the main file.
    await this.#setUpBibliography(main, this.#bibFile(main, setup));
    await formatting.refreshMainSource();
    void build.compile();
  }

  /**
   * Adds the BibTeX entry `text` to the project's `.bib` file (see
   * `citationState`), under a key no other source has; returns that key.
   * Errors propagate to the dialog.
   */
  async addSource(text: string): Promise<string> {
    const main = project.config.main;
    const root = project.root;
    if (!main || !root) throw new Error(m.cite_no_document());
    const entry = parseEntry(text);
    if (!entry) throw new Error(m.cite_invalid_entry());
    const scan = await doc.rescan();
    entry.key = uniqueKey(
      entry.key || entryKey(entry),
      scan.citations.map((c) => c.key),
    );
    const setup = bibSetupOf(await project.mainSource());
    const bib = this.#bibFile(main, setup);
    const code = formatEntry(entry);
    if (await api.projectExists(root, bib)) {
      const old = project.textOf(bib) ?? (await api.projectRead(root, bib));
      const gap = old.trim() ? (old.endsWith("\n") ? "\n" : "\n\n") : "";
      await actions.replaceText("user", bib, old.length, old.length, `${gap}${code}\n`);
    } else {
      await project.createFile(parentDir(bib), fileName(bib), `${code}\n`);
    }
    await this.#setUpBibliography(main, bib);
    await doc.rescan();
    await formatting.refreshMainSource();
    return entry.key;
  }

  /** The BibTeX entry for a DOI or ISBN (see bib.rs); errors in the user's words. */
  async lookUpSource(id: string): Promise<string> {
    try {
      return await api.bibLookup(id);
    } catch (err) {
      const code = errorMessage(err);
      if (code === "not-an-identifier") throw new Error(m.cite_lookup_invalid());
      if (code === "not-found") throw new Error(m.cite_lookup_not_found());
      throw new Error(m.cite_lookup_failed({ error: code }));
    }
  }

  /** Sets the citation style in the main file (biblatex's `style`, or `\bibliographystyle`). */
  async setCitationStyle(style: string) {
    const main = project.config.main;
    if (!main) throw new Error(m.cite_no_document());
    for (const edit of styleEdits(await project.mainSource(), style))
      await actions.replaceText("user", main, edit.from, edit.to, edit.insert);
    await formatting.refreshMainSource();
  }

  /** A footnote at the cursor of the open file, after the selection; the cursor in it. */
  insertFootnote() {
    const editor = project.file ? doc.editorFor(project.file) : null;
    if (!editor) return;
    const { from, to } = editor.selection();
    editor.format(footnoteEdit(editor.getText(), from, to));
  }

  async insertFormula(kind: FormulaKind) {
    const editor = project.file ? doc.editorFor(project.file) : null;
    if (!editor) return;
    if (kind === "inline") {
      const { from, to } = editor.selection();
      editor.format(inlineFormulaEdit(editor.getText(), from, to));
      return;
    }
    const { from, to } = editor.selection();
    const selection = editor.getText().slice(from, to);
    const taken = (project.scan?.labels ?? []).map((l) => l.key);
    const label = uniqueLabel(labelFrom("eq", m.ribbon_formula(), "equation"), taken, true);
    const block = (indent: string) => formulaBlock(kind, selection, label, indent);
    await doc.guard(() => this.#insertBlock(m.formula_no_file(), block("").packages, (_, __, indent) => block(indent)));
  }

  /** A ready-made formula (Pythagoras, …): in math at the cursor, elsewhere set apart on lines of its own. */
  async insertFormulaTemplate(id: FormulaTemplate) {
    const editor = project.file ? doc.editorFor(project.file) : null;
    if (!editor) return;
    const { from, to } = editor.selection();
    if (templateEdit(editor.getText(), from, to, id)) {
      await this.#insertMath((text, start, end) => templateEdit(text, start, end, id)!);
      return;
    }
    await doc.guard(() =>
      this.#insertBlock(m.formula_no_file(), templateBlock(id, "").packages, (_, __, indent) => templateBlock(id, indent)),
    );
  }

  /**
   * Puts a structure such as a fraction at the cursor of the open file, with
   * the selected text in it; outside math in `$…$`. Loads what it needs in the main file.
   */
  async insertStructure(kind: StructureKind) {
    await this.#insertMath((text, from, to) => {
      const indent = indentOf(text.slice(text.lastIndexOf("\n", from - 1) + 1));
      return structureEdit(text, from, to, kind, indent);
    });
  }

  /** Applies what `make` makes of the open file's text and selection, then loads its packages in the main file. */
  async #insertMath(make: (text: string, from: number, to: number) => { edit: FormatEdit; packages: string[] }) {
    const editor = project.file ? doc.editorFor(project.file) : null;
    if (!editor) return;
    const { from, to } = editor.selection();
    const { edit, packages } = make(editor.getText(), from, to);
    editor.format(edit);
    // After the edit went in: the open file may be the main file.
    if (packages.length) await doc.guard(() => doc.loadPackages(packages));
  }

  /** The number LaTeX will give a table inserted at the cursor of the open file (`3`, or `2.1` with chapters). */
  async tableNumberAtCursor(): Promise<string> {
    const file = project.file;
    const editor = file ? doc.editorFor(file) : null;
    if (!file || !editor) return "1";
    const { main, source, read } = await this.#listSource();
    return tableNumberAt({ main, mainSource: source, read, file, offset: editor.selection().from });
  }

  /**
   * Inserts what `make` makes at the cursor of the open file, on lines of its
   * own and indented like the cursor's line, then loads `packages` in the main
   * file where they are missing. `select` (within `code`) is selected afterwards,
   * else the cursor goes behind the block.
   */
  async #insertBlock(
    noFile: string,
    packages: string[],
    make: (main: string, mainSource: string, indent: string) => { code: string; select?: { anchor: number; head: number } },
  ) {
    const file = project.file;
    const main = project.config.main;
    const editor = file ? doc.editorFor(file) : null;
    if (!editor || !main) throw new Error(noFile);
    const text = editor.getText();
    const { from, to } = editor.selection();
    const lineStart = text.lastIndexOf("\n", from - 1) + 1;
    const lineEnd = text.indexOf("\n", to) < 0 ? text.length : text.indexOf("\n", to);
    const indent = indentOf(text.slice(lineStart));
    const block = make(main, await project.mainSource(), indent);
    const before = text.slice(lineStart, from).trim() ? `\n${indent}` : "";
    const after = text.slice(to, lineEnd).trim() ? `\n${indent}` : "";
    const end = before.length + block.code.length;
    const select = block.select
      ? { anchor: before.length + block.select.anchor, head: before.length + block.select.head }
      : { anchor: end, head: end };
    editor.format({ from, to, insert: before + block.code + after, select });
    // After the block went in: the open file may be the main file.
    await doc.loadPackages(packages);
    void build.compile();
  }

  /**
   * What the insert dialog offers for a list of `kind`: the places in the
   * main file's body, the suggested one and the table of contents choice.
   * `source` is the main file it was read from; `insertList` checks it is still the same.
   */
  async listContext(kind: ListKind): Promise<ListContext & { source: string }> {
    const { main, source, read } = await this.#listSource();
    return { ...(await this.#listError(() => listContext({ kind, main, source, read }))), source };
  }

  /**
   * Writes a list (table of contents, bibliography, …) into a new file `name`
   * in the folder `dir` and reads it in the main file at `at`, one of
   * `listContext`'s places, with what the preamble needs for it; returns the
   * new file. Errors propagate to the dialog.
   */
  async insertList(
    kind: ListKind,
    options: { dir: string; name: string; heading: string; at: number; toc: boolean; source: string },
  ): Promise<string> {
    const { root, main, source, read } = await this.#listSource();
    if (source !== options.source) throw new Error(m.lists_changed());
    const file = joinPath(options.dir, validateName(options.name, "file"));
    if (!file.endsWith(".tex")) throw new Error(m.error_file_type({ extensions: ".tex" }));
    if (await api.projectExists(root, file)) throw new Error(m.lists_file_exists({ name: file }));
    const bibFiles = treeFiles(project.tree, (path) => path.endsWith(".bib"));
    const plan = await this.#listError(() =>
      planList({
        kind,
        heading: options.heading.trim(),
        main,
        file,
        source,
        read,
        at: options.at,
        toc: options.toc,
        bibFiles,
        newBib: joinPath(parentDir(main), `${m.lists_bib_file()}.bib`),
      }),
    );
    await project.createFile(options.dir, fileName(file), plan.text);
    if (plan.createBib) await project.createFile(parentDir(plan.createBib), fileName(plan.createBib));
    await actions.replaceText("user", main, plan.edit.from, plan.edit.to, plan.edit.insert);
    void build.compile();
    return file;
  }

  /** The lists the main file prints, by line, for the lists dialog's tabs; none where it cannot be read. */
  async printedLists(): Promise<PrintedList[]> {
    try {
      const { main, source, read } = await this.#listSource();
      return await printedLists({ main, source, read });
    } catch {
      return [];
    }
  }

  /** What the edit dialog offers for the list at the main file's `line`; `source` as with `listContext`. */
  async listEditContext(kind: ListKind, line: number): Promise<ListEditContext & { source: string }> {
    const { main, source, read } = await this.#listSource();
    return { ...(await this.#listError(() => listEditContext({ kind, main, source, read, line }))), source };
  }

  /**
   * Moves the list at the main file's `line` to `at`, one of `listEditContext`'s
   * places, gives it `heading` (`null`: as it is) and puts it into the table of
   * contents or out of it. Errors propagate to the dialog.
   */
  async editList(kind: ListKind, line: number, options: { at: number; heading: string | null; toc: boolean; source: string }) {
    const { main, source, read } = await this.#listSource();
    if (source !== options.source) throw new Error(m.lists_changed());
    const { at, heading, toc } = options;
    const plan = await this.#listError(() => planListEdit({ kind, main, source, read, line, at, heading, toc }));
    if (plan.file) {
      const { path, edit } = plan.file;
      await actions.replaceText("user", path, edit.from, edit.to, edit.insert);
    }
    if (plan.edit) await actions.replaceText("user", main, plan.edit.from, plan.edit.to, plan.edit.insert);
    if (plan.file || plan.edit) void build.compile();
  }

  /** Takes the list at the main file's `line` out of the document; its file goes to the recycle bin unless read in elsewhere too. */
  async removeList(kind: ListKind, line: number, expected: string) {
    const { main, source, read } = await this.#listSource();
    if (source !== expected) throw new Error(m.lists_changed());
    const plan = await this.#listError(() => planListRemoval({ kind, main, source, read, line }));
    await actions.replaceText("user", main, plan.edit.from, plan.edit.to, plan.edit.insert);
    const file = plan.file;
    const elsewhere = project.scan?.inclusions.some((i) => i.file === file && !(i.parent === main && i.line === line));
    if (file && !elsewhere) await project.delete(file);
    void build.compile();
  }

  async #listSource() {
    const root = project.root;
    const main = project.config.main;
    if (!root || !main) throw new Error(m.pdf_no_main());
    return {
      root,
      main,
      source: await project.mainSource(),
      read: async (path: string) => project.textOf(path) ?? (await api.projectRead(root, path).catch(() => "")),
    };
  }

  /** Turns the list module's error codes into messages. */
  async #listError<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (err) {
      if (!(err instanceof ListError)) throw err;
      const messages = {
        "no-document": m.lists_no_document,
        beamer: m.lists_beamer,
        "bibtex-exists": m.lists_bibtex_exists,
        changed: m.lists_changed,
      };
      throw new Error(messages[err.code]());
    }
  }
}

export const inserting = new InsertingStore();
