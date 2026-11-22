// Formatting, as the ribbon's Edit tab shows and sets it: the format at the
// cursor (alignment, size, font, line spacing, heading style, columns), what
// the main file sets for the whole document, the scopes the buttons act on,
// and the commands that change the text accordingly (see $lib/latex).

import { api } from "$lib/api";
import {
  alignDocument,
  alignmentAt,
  alignmentPackages,
  alignRange,
  documentAlignment,
  paragraphRange,
  sectionRange,
  textParagraphs,
  wholeDocumentAlignment,
  type Alignment,
  ALIGN_SCOPES,
  type AlignScope,
} from "$lib/latex/align";
import { listsAt } from "$lib/latex/bullets";
import {
  colorDocument,
  colorParagraphs,
  colorWord,
  highlightColorDefinition,
  isCustomColor,
  recentColors,
  highlightParagraphs,
  highlightSetup,
  highlightWord,
} from "$lib/latex/colors";
import { columnsAt, columnsEdit, documentColumns, documentColumnsEdits } from "$lib/latex/columns";
import {
  DEFAULT_FONT,
  documentFontOf,
  fontCommand,
  fontCommandsOf,
  fontDeclarations,
  fontModeOf,
  setDocumentFont,
  sizeCommand,
} from "$lib/latex/fonts";
import { baseSizeOf, declarationAt, pointsAt, sizeDeclarations, type Emphasis, type FormatEdit } from "$lib/latex/format";
import {
  depthEdit,
  depthOf,
  headingEdit,
  headingNumberedAt,
  headingStyleAt,
  numberHeading,
  secnumdepthEdit,
  secnumdepthOf,
  unnumberHeading,
  type DepthCounter,
  type HeadingStyle,
} from "$lib/latex/headings";
import { marginsSupported, pageLayoutOf } from "$lib/latex/margins";
import { notesHidden as notesHiddenOf } from "$lib/latex/notes";
import {
  declareParagraphs,
  declareRange,
  declareDocument,
  declareWord,
  emphasisPackages,
  emphasisScopes,
  emphasizeDocument,
  emphasizeParagraphs,
  emphasizeWord,
  SCOPES,
  type Scope,
} from "$lib/latex/scope";
import {
  documentStretchOf,
  paragraphSpacingEdits,
  paragraphSpacingOf,
  spacingDocumentEdits,
  spacingPackages,
  spacingRange,
  stretchAt,
  type ParagraphSpacing,
} from "$lib/latex/spacing";
import { BEGIN_DOCUMENT, documentClassOf, hasChapters, maskComments } from "$lib/latex/syntax";
import { m } from "$lib/paraglide/messages";
import { parentDir } from "$lib/util/paths";
import { actions } from "./actions.svelte";
import { available } from "./availability.svelte";
import { build } from "./build.svelte";
import { doc } from "./document.svelte";
import { project } from "./project.svelte";
import { ribbonChoice } from "./ribbon-choices.svelte";

class FormattingStore {
  /** The font size in pt at the cursor of the main editor, for the ribbon's size list. */
  cursorFontSize = $state(10);
  /** The document's base size in pt (`\documentclass[12pt]`), which the size list shows its points for. */
  baseFontSize = $state(10);
  /**
   * The cursor of the main editor: its file and the text before it. `null`
   * while it has none, after another file was shown, until the user puts it
   * in; what acts at the cursor is unavailable until then (see `available`).
   */
  cursor = $state.raw<{ file: string; before: string } | null>(null);
  /** The lists the cursor is in, the outermost first: which list buttons show pressed. */
  cursorLists = $derived(this.cursor ? listsAt(this.cursor.before) : []);
  /** The alignment at the cursor, its own or from around it; `null` without a cursor. */
  cursorAlignment = $state<Alignment | null>(null);
  /** The whole document's alignment, as the main file declares it. */
  mainAlignment = $state<Alignment>("justify");
  /** What a click on an alignment button sets: the whole document unless chosen otherwise or made the default. */
  alignScope = ribbonChoice<AlignScope>("edit", "alignScope", "document", ALIGN_SCOPES);
  /** What the line spacing sets: the whole document unless chosen otherwise or made the default. */
  spacingScope = ribbonChoice<AlignScope>("edit", "spacingScope", "document", ALIGN_SCOPES);
  /** What the font size list sets: the whole document unless chosen otherwise or made the default. */
  sizeScope = ribbonChoice<Scope>("edit", "sizeScope", "document", SCOPES);
  /** What bold, italic, underline, strikethrough and the colours act on, all of them: the word at the cursor unless chosen otherwise. */
  emphasisScope = ribbonChoice<Scope>("edit", "emphasisScope", "word", SCOPES);
  /**
   * Whether text is selected in the main editor. Then the edit tab's functions
   * act on the selection only, whatever their lists say (which are greyed out):
   * size and emphasis on the selected text, alignment on the paragraphs it
   * touches, as alignment is set per paragraph.
   */
  selected = $state(false);
  /** What the font list sets: the whole document unless chosen otherwise. */
  fontScope = ribbonChoice<Scope>("edit", "fontScope", "document", SCOPES);
  /** The colours the text colour and highlight buttons set, as last chosen: xcolor's names, or `#ff8800` from the colour picker. */
  textColor = $state("red");
  highlightColor = $state("yellow");
  /** The colours of the user's own chosen this session, newest first, which the colour lists offer again. */
  customTextColors = $state<string[]>([]);
  customHighlightColors = $state<string[]>([]);
  /** The document's font as the main file sets it (a key, see latex/fonts.ts). */
  documentFont = $state(DEFAULT_FONT);
  /** The font at the cursor: one set for part of the document around it, else the document's. */
  cursorFont = $state(DEFAULT_FONT);
  /** The font families installed on the system, for XeLaTeX and LuaLaTeX; read once, when first needed. */
  systemFonts = $state.raw<string[]>([]);
  #systemFontsRead = false;

  /** What a click on an alignment button acts on now (see `selected`). */
  get alignTarget(): AlignScope {
    return this.selected ? "paragraph" : this.alignScope.value;
  }

  /** What the font size list acts on now (see `selected`). */
  get sizeTarget(): Scope {
    return this.selected ? "word" : this.sizeScope.value;
  }

  /** What the line spacing acts on now: with a selection the paragraphs it touches, as for alignment. */
  get spacingTarget(): AlignScope {
    return this.selected ? "paragraph" : this.spacingScope.value;
  }

  /** What bold, italic, underline, strikethrough and the colours act on now (see `selected`). */
  get emphasisTarget(): Scope {
    return this.selected ? "word" : this.emphasisScope.value;
  }

  /** What the font list acts on now (see `selected`). */
  get fontTarget(): Scope {
    return this.selected ? "word" : this.fontScope.value;
  }
  #cursorTimer: ReturnType<typeof setTimeout> | undefined;
  /** The main file as last read, for the alignment an included file starts in. */
  #mainSource = $state.raw("");
  /** The page the main file sets up (paper, orientation), for the layout tab; `null` where it cannot be set (beamer, no preamble). */
  pageSetup = $derived(marginsSupported(this.#mainSource) ? pageLayoutOf(this.#mainSource) : null);
  /** The whole document's line spacing and space between paragraphs, as the main file sets them (see latex/spacing.ts). */
  documentStretch = $derived(documentStretchOf(this.#mainSource));
  paragraphSpacing = $derived(paragraphSpacingOf(this.#mainSource));
  /** The line spacing at the cursor: of a `spacing` environment around it, else the document's. */
  cursorStretch = $derived((this.cursor ? stretchAt(this.cursor.before) : null) ?? this.documentStretch);
  /** The class of the main file; "" without one. */
  documentClass = $derived(documentClassOf(this.#mainSource)?.name ?? "");
  /** Whether the main file's class has chapters: "Heading 1" is `\chapter` then, else `\section`. */
  chapters = $derived(hasChapters(this.documentClass));
  /** The style of the line at the cursor (see latex/headings.ts); `null` for a heading below the styles offered. */
  headingStyle = $derived(this.cursor ? headingStyleAt(this.cursor.before, this.chapters) : null);
  /** Whether the heading at the cursor gets a number in the document (no star, its level within `secnumdepth`): the toggle shows pressed. */
  headingNumbered = $derived(
    this.cursor ? headingNumberedAt(this.cursor.before, secnumdepthOf(this.#mainSource, this.chapters), this.chapters) : false,
  );
  /** Down to which level the document numbers its headings, and lists them in the table of contents (LaTeX's levels, `\section` 1). */
  numberingDepth = $derived(depthOf(this.#mainSource, "secnumdepth", this.chapters));
  contentsDepth = $derived(depthOf(this.#mainSource, "tocdepth", this.chapters));
  /** How many columns the class sets the whole document in. */
  documentColumns = $derived(documentColumns(this.#mainSource));
  /** The columns of a `multicols` around the cursor; `null` outside one. */
  cursorColumns = $derived(this.cursor ? columnsAt(this.cursor.before) : null);
  /** Whether the notes (todonotes) are hidden, as for handing the work in. */
  notesHidden = $derived(notesHiddenOf(this.#mainSource));
  /**
   * Aligns what `alignTarget` names, as Word does (see `alignRange`): the
   * paragraphs the selection touches, the section the cursor is in, or the
   * whole document by a declaration in the main file that reaches every
   * included file too. Loads ragged2e where justified text must be set explicitly.
   */
  async align(alignment: Alignment) {
    if (!available(`align.${this.alignTarget}`)) return;
    await doc.guard(async () => {
      const main = project.config.main;
      if (this.alignTarget === "document") {
        const edit = alignDocument(await project.mainSource(), alignment);
        if (!main || !edit) throw new Error(m.format_no_document());
        await actions.replaceText("user", main, edit.from, edit.to, edit.insert);
        if (edit.insert.includes("\\justifying")) await doc.loadPackages(alignmentPackages("justify"));
      } else {
        const file = project.file;
        const editor = file ? doc.editorFor(file) : null;
        if (!file || !editor) return;
        const text = editor.getText();
        const { from, to } = editor.selection();
        const range = this.alignTarget === "section" ? sectionRange(text, from) : paragraphRange(text, from, to);
        if (!range) throw new Error(this.alignTarget === "section" ? m.format_no_section() : m.format_no_paragraph());
        const edit = alignRange(text, range, alignment, await this.#outsideAlignment(file), { anchor: from, head: to });
        editor.format(edit);
        if (/\\begin\{justify\}|\\justifying/.test(edit.insert)) await doc.loadPackages(alignmentPackages("justify"));
      }
      await this.refreshMainSource();
      this.readCursorFormat();
    });
  }

  /**
   * Line spacing `stretch` for what `spacingTarget` names: the paragraphs the
   * selection touches or the section at the cursor, by a `spacing`
   * environment; the whole document in the main file's preamble. Loads setspace.
   */
  async setLineSpacing(stretch: number) {
    const scope = this.spacingTarget;
    if (!available(`align.${scope}`)) return;
    await doc.guard(async () => {
      const main = project.config.main;
      if (!main) throw new Error(m.format_no_document());
      const documentStretch = this.documentStretch;
      const needed = scope === "document" ? stretch !== 1 : stretch !== documentStretch;
      if (needed) await doc.loadPackages(spacingPackages(await project.mainSource()));
      if (scope === "document") {
        // Last first, so the offsets of the others stay right.
        for (const edit of spacingDocumentEdits(await project.mainSource(), stretch)) {
          await actions.replaceText("user", main, edit.from, edit.to, edit.insert);
        }
      } else {
        const editor = project.file ? doc.editorFor(project.file) : null;
        if (!editor) return;
        const text = editor.getText();
        const { from, to } = editor.selection();
        const range = scope === "section" ? sectionRange(text, from) : paragraphRange(text, from, to);
        if (!range) throw new Error(scope === "section" ? m.format_no_section() : m.format_no_paragraph());
        editor.format(spacingRange(text, range, stretch, documentStretch, { anchor: from, head: to }));
      }
      await this.refreshMainSource();
    });
  }

  /** The space between paragraphs of the whole document, in the main file's preamble (see latex/spacing.ts). */
  async setParagraphSpacing(spacing: ParagraphSpacing) {
    await doc.guard(async () => {
      const main = project.config.main;
      if (!main) throw new Error(m.format_no_document());
      const edits = paragraphSpacingEdits(await project.mainSource(), spacing);
      // Last first, so the offsets of the others stay right.
      for (const edit of edits) await actions.replaceText("user", main, edit.from, edit.to, edit.insert);
      await this.refreshMainSource();
    });
  }

  /** The alignment `file` starts in: what the main file has where it includes it. */
  async #outsideAlignment(file: string): Promise<Alignment> {
    const main = project.config.main;
    if (!main) return "justify";
    const source = project.textOf(main) ?? (await project.mainSource().catch(() => this.#mainSource));
    if (file === main) return documentAlignment(source);
    return documentAlignment(source, this.#includedAs(file));
  }

  /** `file` as the main file includes it: relative to the main file's folder, without `.tex`. */
  #includedAs(file: string): string {
    const base = parentDir(project.config.main ?? "");
    const relative = base && file.startsWith(`${base}/`) ? file.slice(base.length + 1) : file;
    return relative.replace(/\.tex$/, "");
  }

  /**
   * The alignment and font at the cursor, from the text before it reported
   * last; and the whole document's, from the main file.
   */
  readCursorFormat() {
    const main = project.config.main;
    const source = (main && project.textOf(main)) || this.#mainSource;
    this.mainAlignment = wholeDocumentAlignment(source);
    this.documentFont = documentFontOf(source, fontModeOf(project.config.engine));
    const cursor = this.cursor;
    if (!cursor || cursor.file !== project.file || !cursor.file.endsWith(".tex")) {
      this.cursorAlignment = null;
      this.cursorFont = this.documentFont;
      this.cursorFontSize = this.baseFontSize;
      return;
    }
    this.cursorFontSize = pointsAt(cursor.before, source, this.baseFontSize);
    const outside = cursor.file === main ? documentAlignment(source) : documentAlignment(source, this.#includedAs(cursor.file));
    this.cursorAlignment = alignmentAt(cursor.before, outside);
    const commands = fontCommandsOf(source);
    const command = declarationAt(cursor.before, fontDeclarations(source));
    this.cursorFont = (command && commands.get(command)) || this.documentFont;
  }

  /** Reads the system's fonts, once: the font list offers them under XeLaTeX and LuaLaTeX. */
  async readSystemFonts() {
    if (this.#systemFontsRead) return;
    this.#systemFontsRead = true;
    this.systemFonts = await api.systemFonts().catch(() => []);
  }

  /**
   * Sets what `fontTarget` names in the font `key` (see latex/fonts.ts): the
   * whole document in the main file's preamble; a part by a command for the
   * font declared there (`{\fontPagella …}`). The document's own font for a
   * part takes such a group away.
   */
  async setFont(key: string) {
    const scope = this.fontTarget;
    const mode = fontModeOf(project.config.engine);
    const main = project.config.main;
    let name: string | null = null;
    if (scope !== "document" && key !== this.documentFont) {
      if (!main || !available(`format.${scope}`)) return;
      const declared = await doc.guard(async () => {
        const command = fontCommand(await project.mainSource(), key, mode);
        if (!command) throw new Error(m.format_no_document());
        if (command.edit) await actions.replaceText("user", main, command.edit.from, command.edit.to, command.edit.insert);
        name = command.name;
      });
      if (!declared) return;
    }
    const declarations = fontDeclarations(main ? await project.mainSource().catch(() => this.#mainSource) : "");
    await this.#formatAt(scope, {
      word: (text, from, to) => declareWord(text, from, to, declarations, name),
      paragraphs: (text, paragraphs, select) => declareParagraphs(text, paragraphs, declarations, name, select),
      section: (text, range, select) => declareRange(text, range, declarations, name, select),
      document: (source) => setDocumentFont(source, key, mode),
    });
  }

  async refreshMainSource() {
    if (project.config.main) this.#mainSource = await project.mainSource().catch(() => this.#mainSource);
  }

  /** Bold, italic, underlined or struck out: what `emphasisTarget` names (see `#formatAt`); again takes it away. */
  async emphasize(command: Emphasis) {
    const scope = this.emphasisTarget;
    if (!emphasisScopes(command).includes(scope)) return;
    const paragraphs = (text: string, list: { from: number; to: number }[], select: { anchor: number; head: number }) =>
      emphasizeParagraphs(text, list, command, select);
    await this.#formatAt(
      scope,
      {
        word: (text, from, to) => emphasizeWord(text, from, to, command),
        paragraphs,
        section: (text, range, select) => paragraphs(text, textParagraphs(text, range), select),
        document: (main) => emphasizeDocument(main, command),
      },
      emphasisPackages,
    );
  }

  /**
   * Text colour `color` (one of xcolor's names) for what `emphasisTarget`
   * names (see `#formatAt`); `null` is the document's colour again. A colour
   * becomes the one the button sets next.
   */
  async setTextColor(color: string | null) {
    if (color) {
      this.textColor = color;
      if (isCustomColor(color)) this.customTextColors = recentColors(this.customTextColors, color);
    }
    await this.#formatAt(
      this.emphasisTarget,
      {
        word: (text, from, to) => colorWord(text, from, to, color),
        paragraphs: (text, list, select) => colorParagraphs(text, list, color, select),
        section: (text, range, select) => colorParagraphs(text, textParagraphs(text, range), color, select),
        document: (main) => colorDocument(main, color),
      },
      () => (color ? ["xcolor"] : []),
    );
  }

  /**
   * Highlights what `emphasisTarget` names in `color` (see `#formatAt`), not
   * the whole document, which LaTeX cannot highlight; `null` takes the
   * highlighting away. The main file gets the definition of
   * `\hlc` with the first one (see latex/colors.ts).
   */
  async setHighlight(color: string | null) {
    const scope = this.emphasisTarget;
    if (scope === "document") return;
    if (color) {
      this.highlightColor = color;
      if (isCustomColor(color)) this.customHighlightColors = recentColors(this.customHighlightColors, color);
    }
    const done = await this.#formatAt(
      scope,
      {
        word: (text, from, to) => highlightWord(text, from, to, color),
        paragraphs: (text, list, select) => highlightParagraphs(text, list, color, select),
        section: (text, range, select) => highlightParagraphs(text, textParagraphs(text, range), color, select),
        document: () => null,
      },
      () => (color ? ["xcolor"] : []),
    );
    const main = project.config.main;
    if (!done || !color || !main) return;
    // Read after the highlighting went in: the open file may be the main file.
    const setup = highlightSetup(await project.mainSource());
    if (setup) await actions.replaceText("user", main, setup.at, setup.at, setup.insert);
    // A colour of the user's own goes by a name `\hlc` takes, defined in the preamble.
    const definition = highlightColorDefinition(await project.mainSource(), color);
    if (definition) await actions.replaceText("user", main, definition.at, definition.at, definition.insert);
  }

  /** The whole document in one or two columns (the class option `twocolumn`). */
  async setDocumentColumns(columns: 1 | 2) {
    await doc.guard(async () => {
      const main = project.config.main;
      if (!main) throw new Error(m.page_setup_no_document());
      for (const edit of documentColumnsEdits(await project.mainSource(), columns))
        await actions.replaceText("user", main, edit.from, edit.to, edit.insert);
      await this.refreshMainSource();
      void build.compile();
    });
  }

  /** The selected paragraphs, or the one at the cursor, in `columns` columns (multicol); 1 takes the columns away. */
  async setColumns(columns: 1 | 2 | 3) {
    const editor = project.file ? doc.editorFor(project.file) : null;
    if (!editor) return;
    const { from, to } = editor.selection();
    const edit = columnsEdit(editor.getText(), from, to, columns);
    if (!edit) return;
    editor.format(edit);
    if (columns > 1) await doc.guard(() => doc.loadPackages(["multicol"]));
  }

  /** Follows the cursor of the main editor, a moment after it stops: the size list and alignment buttons need not keep up with every key. */
  onCursor(before: string | null, selected = false) {
    clearTimeout(this.#cursorTimer);
    // At once, not after the pause: the lists grey out as the selection is made.
    this.selected = before !== null && selected;
    // Another file shown: no cursor at once, so nothing acts at the old one meanwhile.
    if (before === null || !project.file) {
      this.cursor = null;
      this.readCursorFormat();
      return;
    }
    const file = project.file;
    this.#cursorTimer = setTimeout(() => {
      this.cursor = { file, before };
      this.readCursorFormat();
    }, 80);
  }

  /**
   * Reads the document's base size again, e.g. after the main file changed or
   * a build; and the main file's alignment, which included files start in.
   */
  async refreshBaseFontSize() {
    if (!project.config.main) return;
    await this.refreshMainSource();
    this.baseFontSize = baseSizeOf(this.#mainSource);
    this.readCursorFormat();
  }

  /**
   * Sets what `sizeTarget` names in `points` (see `#formatAt`), by a command
   * for the size declared in the main file's preamble (`{\sizeFourteen …}`);
   * fix-cm lets the default font take any size. The document's base size
   * takes a size group away.
   */
  async fontSize(points: number) {
    const scope = this.sizeTarget;
    const main = project.config.main;
    let name: string | null = null;
    if (points !== this.baseFontSize) {
      if (!main || !available(`format.${scope}`)) return;
      const declared = await doc.guard(async () => {
        const command = sizeCommand(await project.mainSource(), points);
        if (!command) throw new Error(m.format_no_document());
        if (command.edit) await actions.replaceText("user", main, command.edit.from, command.edit.to, command.edit.insert);
        name = command.name;
      });
      if (!declared) return;
    }
    const declarations = sizeDeclarations(main ? await project.mainSource().catch(() => this.#mainSource) : "");
    await this.#formatAt(
      scope,
      {
        word: (text, from, to) => declareWord(text, from, to, declarations, name),
        paragraphs: (text, paragraphs, select) => declareParagraphs(text, paragraphs, declarations, name, select),
        section: (text, range, select) => declareRange(text, range, declarations, name, select),
        document: (source) => declareDocument(source, sizeDeclarations(source), name),
      },
      () => (name ? ["fix-cm"] : []),
    );
  }

  /**
   * A font button's change, at `scope`: the selection or the word at the
   * cursor (else what is typed next), the paragraphs the selection touches,
   * the section the cursor is in, or the whole document by a declaration in
   * the main file. Loads in the main file what the change needs (`packages`).
   * Returns whether it went in.
   */
  async #formatAt(
    scope: Scope,
    change: {
      word: (text: string, from: number, to: number) => FormatEdit;
      paragraphs: (text: string, paragraphs: { from: number; to: number }[], select: { anchor: number; head: number }) => FormatEdit | null;
      section: (text: string, range: { from: number; to: number }, select: { anchor: number; head: number }) => FormatEdit | null;
      document: (main: string) => FormatEdit | null;
    },
    packages: (edit: FormatEdit) => string[] = () => [],
  ): Promise<boolean> {
    if (!available(`format.${scope}`)) return false;
    return doc.guard(async () => {
      let edit: FormatEdit | null;
      if (scope === "document") {
        const main = project.config.main;
        edit = main ? change.document(await project.mainSource()) : null;
        if (!main || !edit) throw new Error(m.format_no_document());
        await actions.replaceText("user", main, edit.from, edit.to, edit.insert);
      } else {
        const editor = project.file ? doc.editorFor(project.file) : null;
        if (!editor) return;
        const text = editor.getText();
        const { from, to } = editor.selection();
        const select = { anchor: from, head: to };
        if (scope === "word") edit = change.word(text, from, to);
        else if (scope === "paragraph") {
          const range = paragraphRange(text, from, to);
          edit = range && change.paragraphs(text, textParagraphs(text, range), select);
          if (!edit) throw new Error(m.format_no_paragraph());
        } else {
          const range = sectionRange(text, from);
          edit = range && change.section(text, range, select);
          if (!edit) throw new Error(m.format_no_section());
        }
        editor.format(edit);
      }
      const names = packages(edit);
      if (names.length) await doc.loadPackages(names);
      await this.refreshMainSource();
      this.readCursorFormat();
    });
  }

  /** Makes the paragraph at the cursor of the open file a heading of `style`, or plain text (see latex/headings.ts). */
  setHeadingStyle(style: HeadingStyle) {
    const editor = project.file ? doc.editorFor(project.file) : null;
    if (!editor) return;
    const { from, to } = editor.selection();
    const edit = headingEdit(editor.getText(), from, to, style, this.chapters);
    if (edit) editor.format(edit);
  }

  /**
   * The ribbon's toggle: a heading at the cursor the document numbers loses its
   * number (`\section*`); another gets one, for good: its star goes (KOMA's
   * `\addsec` becomes `\section`), and where its level lies below the main
   * file's `secnumdepth`, that is raised to it, which numbers the level's other
   * headings too, as LaTeX does.
   */
  async toggleHeadingNumbering() {
    const editor = project.file ? doc.editorFor(project.file) : null;
    if (!editor) return;
    const at = editor.selection().from;
    if (this.headingNumbered) {
      const edit = unnumberHeading(editor.getText(), at);
      if (edit) editor.format(edit);
      return;
    }
    const numbered = numberHeading(editor.getText(), at, this.chapters);
    if (!numbered) return;
    if (numbered.edit) editor.format(numbered.edit);
    const main = project.config.main;
    if (!main) return;
    // After the heading's edit: in the main file the preamble lies before it, and would move it.
    await doc.guard(async () => {
      const edit = secnumdepthEdit(await project.mainSource(), numbered.level, this.chapters);
      if (edit) await actions.replaceText("user", main, edit.from, edit.to, edit.insert);
    });
    await this.refreshMainSource();
  }

  /** Numbers the document's headings (`secnumdepth`), or lists them in the table of contents (`tocdepth`), down to `level`, in the main file's preamble. */
  async setHeadingDepth(counter: DepthCounter, level: number) {
    const main = project.config.main;
    if (!main) return;
    await doc.guard(async () => {
      const source = await project.mainSource();
      if (!BEGIN_DOCUMENT.test(maskComments(source))) throw new Error(m.format_no_document());
      const edit = depthEdit(source, counter, level, this.chapters);
      if (edit) await actions.replaceText("user", main, edit.from, edit.to, edit.insert);
    });
    await this.refreshMainSource();
  }
}

export const formatting = new FormattingStore();
