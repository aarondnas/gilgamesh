// Framework-independent CodeMirror setup for LaTeX sources.
import { basicSetup } from "codemirror";
import { indentLess, insertTab, isolateHistory, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { latexCompletions, type CompletionData } from "./completions";
import { refreshSpelling, spellChecking, type SpellOptions } from "./spell-check";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { openSearchPanel, search, searchPanelOpen } from "@codemirror/search";
import { EditorView, keymap, type Panel } from "@codemirror/view";
import type { Diagnostic } from "$lib/api";
import { syntaxOf } from "$lib/config/project-files";
import { carriesFiles } from "$lib/util/dropped-files";
import type { FormatEdit } from "../latex/format";
import { lineHover, type LineAction } from "./line-hover";
import {
  acceptAll,
  aiReview,
  originalText,
  rejectAll,
  restoreReview,
  reviewOf,
  reviewSections,
  reviewState,
  type ReviewOptions,
  type ReviewSection,
} from "./ai-review";

/** Who made a change (e.g. `"assistant"`); edits without it are the user's typing. */
const actorOf = Annotation.define<string>();

export interface LatexEditor {
  /**
   * Moves the editor into `parent`, possibly in another window's document,
   * keeping documents, undo history and cursor.
   */
  attach(parent: HTMLElement): void;
  getText(): string;
  /**
   * Shows the document `key` (e.g. a file path). Each key keeps its own state,
   * so undo history and cursor survive switching between files, as long as
   * the text is still the one the editor last saw.
   */
  load(key: string, text: string): void;
  /** Forgets all remembered documents, e.g. when another project opens. */
  reset(): void;
  /**
   * Hands the remembered state of `key` (text, undo history, cursor) over,
   * e.g. to another editor that shows the file in a window of its own; the
   * editor then forgets it. For the shown document, show another one next.
   */
  takeState(key: string): EditorState | null;
  /** Remembers a state taken from another editor; `load(key, …)` shows it. */
  cache(key: string, state: EditorState): void;
  /** Keeps remembered documents under `from` (a file or folder) after it moved to `to`. */
  rename(from: string, to: string): void;
  /** Forgets documents under `key` (a file or folder) after it was deleted. */
  forget(key: string): void;
  /** Undoes one step in the open document; `false` if there was none. */
  undo(): boolean;
  redo(): boolean;
  /** Undo and redo steps of the open document. */
  historyDepth(): { undo: number; redo: number };
  /**
   * Replaces the whole text as one undoable step of `actor`, e.g. restoring a
   * version. The step never merges with other edits. Anyone's but the user's
   * scrolls to where the text starts to differ.
   */
  replaceContent(text: string, actor: string): void;
  /**
   * Replaces `from`…`to` (character offsets) as one undoable step of `actor`
   * that never merges with other edits. Keeps focus where it is. An
   * assistant's change is selected and scrolled to, so its arrival can be
   * seen; one of the app's own (`"user"`, e.g. a package loaded in the
   * preamble) leaves the user's cursor and view where they are.
   */
  replaceRange(from: number, to: number, text: string, actor: string): void;
  /**
   * Replaces `from`…`to` in the document `key` while another is shown, as
   * one undoable step of `actor`. `text` is the file as it is now: a
   * remembered state of another text no longer fits and starts anew.
   * Returns the new text, for the caller to save.
   */
  changeHidden(key: string, text: string, from: number, to: number, insert: string, actor: string): string;
  /** Undo and redo steps of the document `key` while not shown; `null` if none is remembered for `text`. */
  hiddenHistory(key: string, text: string): { undo: number; redo: number } | null;
  /** Undoes (or redoes) one step in the document `key` while not shown; the new text, `null` if there was none. */
  undoHidden(key: string, text: string): string | null;
  redoHidden(key: string, text: string): string | null;
  /** The main selection as character offsets; `from === to` when nothing is selected. */
  selection(): { from: number; to: number };
  /** Applies a format button's change as one undoable step of the user and returns focus to the text. */
  format(edit: FormatEdit): void;
  /** Sections of the shown document whose assistant's changes await review. */
  reviewSections(): ReviewSection[];
  /**
   * Accepts every change awaiting review in the document `key` (the shown one
   * by default), also in a document remembered but not shown; `false` if
   * this editor holds no such document.
   */
  acceptAllChanges(key?: string): boolean;
  /** Marks the changes since `original` in the shown document for review, e.g. after a restart. */
  restoreReview(original: string): void;
  /** Rejects every change awaiting review in the shown document, as one undoable step. */
  rejectAllChanges(): void;
  /** Shows diagnostics that belong to the current document. */
  setDiagnostics(diagnostics: Diagnostic[]): void;
  goToLine(line: number): void;
  /** Checks spelling again; `forget` drops cached results (the user's dictionary changed). */
  refreshSpelling(forget?: boolean): void;
  /** 1-based line of the cursor. */
  currentLine(): number;
  focus(): void;
  /**
   * Opens the search bar as Ctrl+F does, with the selected word as query; with
   * `adopt` false only shows it, e.g. after jumping to a hit in this file.
   */
  openSearch(adopt?: boolean): void;
  /** Selects `from`…`to` and scrolls it into the middle, e.g. a search hit; the focus stays where it is. */
  select(from: number, to: number): void;
  /** Scales the text, line numbers included (1 = normal size). */
  setZoom(zoom: number): void;
  /** CodeMirror's own texts (search panel, …) in the UI language, keyed by their English original. */
  setPhrases(phrases: Record<string, string>): void;
  destroy(): void;
}

export interface LatexEditorOptions {
  doc: string;
  onChange: (text: string) => void;
  /** Spell checking; omitted means none. */
  spell?: SpellOptions;
  /** Project labels, bibliography keys and packages for completions. */
  completionData?: () => CompletionData;
  /**
   * Called for each new edit (not for undo and redo), with who made it
   * (`"user"` for typing), the document's undo depth afterwards and its key.
   */
  onEdit?: (actor: string, undoDepth: number, key: string) => void;
  /** Extra shortcuts, e.g. `{ "Mod-s": save }`. Return true if handled. */
  shortcuts?: Record<string, () => boolean>;
  /** Texts of the review controls under an assistant's changes (see `ai-review.ts`). */
  reviewLabels?: ReviewOptions["labels"];
  /**
   * Called when the sections awaiting review of document `key` change, with
   * its text and the original they differ from; an empty list (and `null`)
   * once all are accepted or rejected.
   */
  onReview?: (key: string, sections: ReviewSection[], text: string, original: string | null) => void;
  /** The button left of the hovered line (see `line-hover.ts`); without it, lines only light up. */
  lineAction?: LineAction;
  /**
   * Called when the cursor moves or the text changes, with the text before
   * the cursor (at most `CURSOR_CONTEXT` characters) and whether text is
   * selected; with `null` when another document is shown, which has no
   * cursor until the user puts one in it (a click, or a jump to a line).
   */
  onCursor?: (before: string | null, selected: boolean) => void;
  /** A search bar of its own in place of CodeMirror's, e.g. one over all files of the project. */
  search?: SearchHooks;
}

export interface SearchHooks {
  /** The bar, made when the panel opens (see CodeMirror's `createPanel`). */
  panel: (view: EditorView) => Panel;
  /** Ctrl+F: open the bar, or focus it, with the selected word as query. */
  open: (view: EditorView) => void;
  /** F3, Ctrl+G, Shift for back: the next or previous hit. */
  step: (view: EditorView, back: boolean) => void;
}

/** How much text before the cursor `onCursor` gets: enough for the groups around it. */
const CURSOR_CONTEXT = 20_000;

/** Changes from anyone but the user (an assistant, any other interface) await review. */
const fromAssistant = (tr: { annotation: (type: typeof actorOf) => string | undefined }) => {
  const actor = tr.annotation(actorOf);
  return actor !== undefined && actor !== "user";
};

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--surface)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
  ".cm-gutters": {
    backgroundColor: "var(--surface-2)",
    color: "var(--text-muted)",
    borderRight: "1px solid var(--border)",
    // Line numbers are text, so the pointer would otherwise turn into an I-beam.
    cursor: "default",
  },
  ".cm-content": { paddingBlock: "var(--space-4)", cursor: "var(--cursor-text)" },
  // The selection is drawn below the text, so the active line must not cover it.
  ".cm-activeLine": { backgroundColor: "var(--line-highlight)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--hover)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--selection)",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--pressed)" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  // CodeMirror's own popups and panels come light; these follow the app's colors, dark mode included.
  ".cm-tooltip": {
    backgroundColor: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--pressed)", color: "var(--text)" },
  ".cm-completionDetail, .cm-completionInfo": { color: "var(--text-muted)" },
  ".cm-panels": { backgroundColor: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  // "Go to line" looks like the app's own fields and outline buttons (app.css, `Button`); the search bar is the app's own.
  ".cm-panel.cm-gotoLine": { padding: "var(--space-3) var(--space-5)" },
  ".cm-panel.cm-gotoLine input, .cm-panel.cm-gotoLine button": { margin: "var(--space-1) var(--space-3) var(--space-1) 0" },
  ".cm-textfield": {
    height: "24px",
    boxSizing: "border-box",
    padding: "var(--space-1) var(--space-3)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "var(--surface)",
    color: "var(--text)",
    font: "inherit",
    fontSize: "var(--font-sm)",
  },
  ".cm-button": {
    height: "24px",
    boxSizing: "border-box",
    padding: "0 var(--space-4)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    backgroundImage: "none",
    backgroundColor: "var(--surface)",
    color: "var(--text)",
    font: "inherit",
    fontSize: "var(--font-sm)",
  },
  ".cm-button:hover": { backgroundColor: "var(--hover)" },
  ".cm-button:active": { backgroundImage: "none", backgroundColor: "var(--pressed)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--warning) 30%, transparent)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--warning) 55%, transparent)" },
  ".cm-matchingBracket": { backgroundColor: "var(--pressed)", color: "inherit" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--surface-2)", color: "var(--text-muted)", border: "1px solid var(--border)" },
});

/**
 * LaTeX colors as CSS variables (`--syn-*` in app.css), so light and dark mode
 * each have readable ones; CodeMirror's default style is made for light backgrounds.
 */
const latexHighlight = HighlightStyle.define([
  { tag: tags.tagName, color: "var(--syn-command)" },
  { tag: tags.keyword, color: "var(--syn-keyword)" },
  { tag: tags.comment, color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: tags.atom, color: "var(--syn-atom)" },
  { tag: tags.number, color: "var(--syn-number)" },
  { tag: tags.special(tags.variableName), color: "var(--syn-special)" },
  { tag: tags.bracket, color: "var(--syn-bracket)" },
  { tag: tags.invalid, color: "var(--syn-invalid)" },
  // Lua's.
  { tag: tags.string, color: "var(--syn-atom)" },
  { tag: tags.standard(tags.variableName), color: "var(--syn-command)" },
]);

const LANGUAGES = { latex: StreamLanguage.define(stex), lua: StreamLanguage.define(lua) };

/** The highlighting for the file `key` names: LaTeX for its sources, none for data and notes. */
const syntaxFor = (key: string | null) => {
  const syntax = key ? syntaxOf(key) : "latex";
  return syntax === "plain" ? [] : LANGUAGES[syntax];
};

/**
 * Text size as a theme of its own: CodeMirror re-measures its line heights
 * only when the theme changes, not when CSS around it does. Without that,
 * clicks would land on the wrong line after zooming.
 */
const zoomTheme = (zoom: number) => EditorView.theme({ "&": { fontSize: `calc(var(--font-base) * ${zoom})` } });

// Shared by all editors: a state taken from one editor is reconfigured with
// the other's text size and with its own callbacks (saving, shortcuts, …)
// when that one shows it, while text, history and cursor stay as they were.
const zoomSetting = new Compartment();
const instanceHooks = new Compartment();
/** Whether the shown document has a cursor yet; without one, neither cursor nor active line are drawn. */
const cursorPlacement = new Compartment();
/** Follows the file's type, also when a remembered state is shown under a new name. */
const syntaxSetting = new Compartment();
const phraseSetting = new Compartment();
const unplaced = EditorView.editorAttributes.of({ class: "cm-unplaced" });

const unplacedTheme = EditorView.theme({
  "&.cm-unplaced .cm-cursorLayer, &.cm-unplaced .cm-selectionLayer": { visibility: "hidden" },
  "&.cm-unplaced .cm-activeLine, &.cm-unplaced .cm-activeLineGutter": { backgroundColor: "transparent" },
});

/** While set, no editor changes its text (see `freezeEditors`). */
let frozen = false;

/**
 * Stops every editor from changing its text, or lets them again: the files are
 * saved for an update and Gilgamesh is about to end, so nothing typed now
 * would be written (see `updates.svelte.ts`).
 */
export function freezeEditors(freeze: boolean) {
  frozen = freeze;
}

/** Drops changes to the text while the editors are frozen. */
const frozenFilter = EditorState.transactionFilter.of((tr) => (frozen && tr.docChanged ? [] : tr));

export function createLatexEditor(parent: HTMLElement, options: LatexEditorOptions): LatexEditor {
  const shortcuts = Object.entries(options.shortcuts ?? {}).map(([key, run]) => ({ key, run, preventDefault: true }));
  const states = new Map<string, EditorState>();
  let currentKey: string | null = null;
  let zoom = 1;
  let phrases: Record<string, string> = {};
  /** Whether the user has put the cursor into the shown document (see `onCursor`). */
  let placed = false;

  const reportCursor = (state: EditorState) => {
    const head = state.selection.main.head;
    options.onCursor?.(state.sliceDoc(Math.max(0, head - CURSOR_CONTEXT), head), !state.selection.main.empty);
  };

  const report = (key: string | null, state: EditorState) => {
    if (key !== null) options.onReview?.(key, reviewSections(state), state.doc.toString(), originalText(state));
  };

  /** Everything that belongs to this editor rather than to the document. */
  const searchHooks = options.search;
  const hooks = [
    keymap.of(shortcuts),
    ...(searchHooks
      ? [
          search({ createPanel: searchHooks.panel }),
          // Also in the bar ("search-panel"), where CodeMirror's own would search the shown file only.
          keymap.of(
            [
              { key: "Mod-f", run: (v: EditorView) => (searchHooks.open(v), true) },
              {
                key: "F3",
                run: (v: EditorView) => (searchHooks.step(v, false), true),
                shift: (v: EditorView) => (searchHooks.step(v, true), true),
              },
              {
                key: "Mod-g",
                run: (v: EditorView) => (searchHooks.step(v, false), true),
                shift: (v: EditorView) => (searchHooks.step(v, true), true),
              },
            ].map((binding) => ({ ...binding, scope: "editor search-panel", preventDefault: true })),
          ),
        ]
      : []),
    ...(options.spell ? [spellChecking(options.spell)] : []),
    ...(options.completionData ? [EditorState.languageData.of(() => [{ autocomplete: latexCompletions(options.completionData!) }])] : []),
    ...(options.reviewLabels ? [aiReview({ fromAssistant, labels: options.reviewLabels })] : []),
    lineHover(options.lineAction),
    EditorView.updateListener.of((update) => {
      if (reviewOf(update.startState) !== reviewOf(update.state)) report(currentKey, update.state);
    }),
    EditorView.updateListener.of((update) => {
      if (placed && (update.docChanged || update.selectionSet)) reportCursor(update.state);
    }),
    // The user puts the cursor in: a click, Tab, or a jump to a line (which focuses the editor).
    EditorView.domEventHandlers({
      focus: (_event, view) => {
        if (placed) return;
        placed = true;
        view.dispatch({ effects: cursorPlacement.reconfigure([]) });
        reportCursor(view.state);
      },
    }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      options.onChange(update.state.doc.toString());
      const changes = update.transactions.filter((tr) => tr.docChanged);
      if (!changes.some((tr) => tr.isUserEvent("undo") || tr.isUserEvent("redo"))) {
        const actor = changes.map((tr) => tr.annotation(actorOf)).find(Boolean) ?? "user";
        options.onEdit?.(actor, undoDepth(update.state), currentKey ?? "");
      }
    }),
  ];

  const makeState = (doc: string, key: string | null = null) =>
    EditorState.create({
      doc,
      extensions: [
        // First, so its shortcuts win over basicSetup's.
        instanceHooks.of(hooks),
        // CodeMirror leaves Tab to focus navigation by default; in a code editor it
        // indents: a tab at the cursor, or the selected lines. Escape, then Tab
        // still moves focus on, for keyboard users.
        keymap.of([{ key: "Tab", run: insertTab, shift: indentLess }]),
        // Includes the history with Mod-z, Mod-y and Mod-Shift-z.
        basicSetup,
        syntaxSetting.of(syntaxFor(key)),
        // basicSetup's default style is only a fallback: this one replaces it.
        syntaxHighlighting(latexHighlight),
        lintGutter(),
        // CodeMirror would paste a dropped file's bytes as text; files go into the explorer instead.
        EditorView.domEventHandlers({ drop: (event) => carriesFiles(event) }),
        theme,
        unplacedTheme,
        cursorPlacement.of(unplaced),
        zoomSetting.of(zoomTheme(zoom)),
        phraseSetting.of(EditorState.phrases.of(phrases)),
        // With the document, so a review survives switching files and detaching.
        reviewState,
        frozenFilter,
      ],
    });

  const view = new EditorView({ parent, state: makeState(options.doc) });

  /** Undo or redo in a remembered document that is not shown; its new text, `null` if nothing was done. */
  const stepHidden = (key: string, text: string, command: typeof undo): string | null => {
    const state = states.get(key);
    if (!state || state.doc.toString() !== text) return null;
    let next: EditorState | null = null;
    if (!command({ state, dispatch: (tr) => (next = tr.state) }) || !next) return null;
    states.set(key, next);
    return (next as EditorState).doc.toString();
  };

  return {
    attach(target) {
      target.append(view.dom);
      // Styles and window listeners belong to the document the editor is shown in.
      view.setRoot(target.ownerDocument);
      view.requestMeasure();
    },
    getText: () => view.state.doc.toString(),
    load(key, text) {
      if (currentKey !== null) states.set(currentKey, view.state);
      const cached = states.get(key);
      // Changed on disk in the meantime: the old history would no longer fit.
      view.setState(cached && cached.doc.toString() === text ? cached : makeState(text, key));
      states.delete(key);
      currentKey = key;
      // Another document has no cursor until the user puts one in (see `onCursor`).
      placed = false;
      if (view.hasFocus) view.contentDOM.blur();
      // A file opened before the last zoom change still has the old size, and
      // a state from another editor still reports to that one.
      view.dispatch({
        effects: [
          zoomSetting.reconfigure(zoomTheme(zoom)),
          instanceHooks.reconfigure(hooks),
          cursorPlacement.reconfigure(unplaced),
          syntaxSetting.reconfigure(syntaxFor(key)),
          phraseSetting.reconfigure(EditorState.phrases.of(phrases)),
        ],
      });
      options.onCursor?.(null, false);
      // A remembered review is reported again. A fresh state has none, but that
      // does not settle the file: its marks come back from the review store
      // (`review.restore`, called right after loading), which reports them.
      if (reviewOf(view.state)) report(key, view.state);
    },
    reset() {
      states.clear();
      currentKey = null;
    },
    takeState(key) {
      if (key === currentKey) {
        currentKey = null;
        return view.state;
      }
      const state = states.get(key) ?? null;
      states.delete(key);
      return state;
    },
    cache(key, state) {
      states.set(key, state);
    },
    rename(from, to) {
      const moved = (key: string) => (key === from || key.startsWith(`${from}/`) ? to + key.slice(from.length) : key);
      for (const [key, state] of [...states]) {
        states.delete(key);
        states.set(moved(key), state);
      }
      if (currentKey === null) return;
      currentKey = moved(currentKey);
      // `a.txt` renamed to `a.tex` is highlighted from now on.
      view.dispatch({ effects: syntaxSetting.reconfigure(syntaxFor(currentKey)) });
    },
    forget(key) {
      const inside = (k: string) => k === key || k.startsWith(`${key}/`);
      for (const k of [...states.keys()]) if (inside(k)) states.delete(k);
      if (currentKey !== null && inside(currentKey)) currentKey = null;
    },
    undo: () => undo(view),
    redo: () => redo(view),
    historyDepth: () => ({ undo: undoDepth(view.state), redo: redoDepth(view.state) }),
    replaceContent(text, actor) {
      // Someone else's change is shown where it starts, so its arrival can be seen.
      const old = view.state.doc.toString();
      let first = 0;
      while (first < old.length && first < text.length && old.charCodeAt(first) === text.charCodeAt(first)) first++;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        effects: actor === "user" ? [] : EditorView.scrollIntoView(first, { y: "center" }),
        annotations: [actorOf.of(actor), isolateHistory.of("full")],
        userEvent: "input.replace",
      });
    },
    replaceRange(from, to, text, actor) {
      const shown = actor !== "user";
      view.dispatch({
        changes: { from, to, insert: text },
        selection: shown ? { anchor: from, head: from + text.length } : undefined,
        effects: shown ? EditorView.scrollIntoView(from, { y: "center" }) : [],
        annotations: [actorOf.of(actor), isolateHistory.of("full")],
        userEvent: "input.replace",
      });
    },
    changeHidden(key, text, from, to, insert, actor) {
      const cached = states.get(key);
      const state = cached && cached.doc.toString() === text ? cached : makeState(text, key);
      const changed = state.update({
        changes: { from, to, insert },
        annotations: [actorOf.of(actor), isolateHistory.of("full")],
        userEvent: "input.replace",
      }).state;
      states.set(key, changed);
      options.onEdit?.(actor, undoDepth(changed), key);
      return changed.doc.toString();
    },
    hiddenHistory(key, text) {
      const state = states.get(key);
      if (!state || state.doc.toString() !== text) return null;
      return { undo: undoDepth(state), redo: redoDepth(state) };
    },
    undoHidden: (key, text) => stepHidden(key, text, undo),
    redoHidden: (key, text) => stepHidden(key, text, redo),
    selection: () => {
      const { from, to } = view.state.selection.main;
      return { from, to };
    },
    format({ from, to, insert, select }) {
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + select.anchor, head: from + select.head },
        scrollIntoView: true,
        annotations: isolateHistory.of("full"),
        userEvent: "input.format",
      });
      view.focus();
    },
    reviewSections: () => reviewSections(view.state),
    acceptAllChanges(key = currentKey ?? undefined) {
      if (key === undefined) return false;
      if (key === currentKey) {
        view.dispatch(acceptAll(view.state));
        return true;
      }
      const state = states.get(key);
      if (!state) return false;
      // Not on screen: nothing to animate, and it would play once the file is shown.
      const accepted = acceptAll(state, false).state;
      states.set(key, accepted);
      report(key, accepted);
      return true;
    },
    restoreReview(original) {
      view.dispatch(restoreReview(view.state, original));
    },
    rejectAllChanges() {
      const tr = rejectAll(view.state);
      if (tr) view.dispatch(tr);
    },
    setDiagnostics(diagnostics) {
      const doc = view.state.doc;
      const mapped: CmDiagnostic[] = diagnostics.map((d) => {
        const line = doc.line(Math.min(Math.max(d.line ?? 1, 1), doc.lines));
        return { from: line.from, to: line.to, severity: d.severity, message: d.message };
      });
      view.dispatch(setDiagnostics(view.state, mapped));
    },
    goToLine(lineNumber) {
      const doc = view.state.doc;
      const line = doc.line(Math.min(Math.max(lineNumber, 1), doc.lines));
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
      view.focus();
    },
    currentLine: () => view.state.doc.lineAt(view.state.selection.main.head).number,
    refreshSpelling: (forget = false) => view.dispatch({ effects: refreshSpelling.of({ forget }) }),
    focus: () => view.focus(),
    openSearch(adopt = true) {
      if (adopt && options.search) options.search.open(view);
      else if (!searchPanelOpen(view.state)) openSearchPanel(view);
    },
    select(from, to) {
      placed = true;
      view.dispatch({
        selection: { anchor: from, head: to },
        effects: [EditorView.scrollIntoView(from, { y: "center" }), cursorPlacement.reconfigure([])],
      });
      reportCursor(view.state);
    },
    setZoom(value) {
      zoom = value;
      view.dispatch({ effects: zoomSetting.reconfigure(zoomTheme(zoom)) });
    },
    setPhrases(value) {
      phrases = value;
      view.dispatch({ effects: phraseSetting.reconfigure(EditorState.phrases.of(phrases)) });
    },
    destroy: () => view.destroy(),
  };
}
