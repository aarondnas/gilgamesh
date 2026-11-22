// The CodeMirror editors: the main editor all files share, one of its own
// for a file in a detached tab, their zoom, and the search bar inside them.

import { mount, unmount } from "svelte";
import { api } from "$lib/api";
import SearchBar from "$lib/components/editor/SearchBar.svelte";
import { createLatexEditor, type LatexEditor } from "$lib/editor/latex-editor";
import { m } from "$lib/paraglide/messages";
import { actions } from "./actions.svelte";
import { doc } from "./document.svelte";
import { build } from "./build.svelte";
import { formatting } from "./formatting.svelte";
import { packages } from "./packages.svelte";
import { project, type FileBuffer } from "./project.svelte";
import { review } from "./review.svelte";
import { projectSearch } from "./search.svelte";
import { settings } from "./settings.svelte";

export const MIN_EDITOR_ZOOM = 0.5;
export const MAX_EDITOR_ZOOM = 2.5;

/** Only `.tex` files hold prose; .sty, .cls, .bib, … are code or data. */
const spellLanguageOf = (file: string | null) => (file?.toLowerCase().endsWith(".tex") ? project.spellLanguage : null);

/** Dictionary for the main editor's file. */
export const spellLanguage = () => spellLanguageOf(project.file);

/** `exact` keeps a typed value such as 125 %; steps are rounded so they land on 90 %, 100 %, … */
export function setEditorZoom(value: number, exact = false) {
  const rounded = exact ? Math.round(value * 100) / 100 : Math.round(value * 10) / 10;
  const clamped = Math.min(Math.max(rounded, MIN_EDITOR_ZOOM), MAX_EDITOR_ZOOM);
  if (clamped !== settings.data.editorZoom) settings.update({ editorZoom: clamped });
}

/** CodeMirror's own texts (search panel, go to line, …), keyed by its English originals. */
const phrases = (): Record<string, string> => ({
  Find: m.cm_find(),
  Replace: m.cm_replace_placeholder(),
  next: m.cm_next(),
  previous: m.cm_previous(),
  all: m.cm_all(),
  "match case": m.cm_match_case(),
  regexp: m.cm_regexp(),
  "by word": m.cm_by_word(),
  replace: m.cm_replace(),
  "replace all": m.cm_replace_all(),
  close: m.cm_close(),
  "Go to line": m.cm_go_to_line(),
  go: m.cm_go(),
  "current match": m.cm_current_match(),
  "No matches": m.cm_no_matches(),
  "on line": m.cm_on_line(),
  "replaced $ matches": m.cm_replaced_matches(),
  "replaced match on line $": m.cm_replaced_match_on_line(),
  Completions: m.cm_completions(),
  Diagnostics: m.cm_diagnostics(),
  "No diagnostics": m.cm_no_diagnostics(),
  "Selection deleted": m.cm_selection_deleted(),
  "folded code": m.cm_folded_code(),
  unfold: m.cm_unfold(),
  to: m.cm_to(),
  "Control character": m.cm_control_character(),
});

/** What sets one editor apart from another: where its text goes. */
interface EditorHooks {
  onChange: (text: string) => void;
  /** The text before the cursor and whether text is selected, whenever the cursor moves; `null` while there is none (see `LatexEditorOptions.onCursor`). */
  onCursor?: (before: string | null, selected: boolean) => void;
  /** The file shown, for the spelling dictionary. */
  file: () => string | null;
  /** The spot in the PDF of `line` (the button left of a hovered line), else of the cursor's (Ctrl+Alt+J). */
  syncToPdf: (line?: number) => void;
}

/** An editor with everything Gilgamesh adds: spelling, completions, shortcuts, the timeline. */
function buildEditor(hooks: EditorHooks): LatexEditor {
  const zoom = () => settings.data.editorZoom;
  const editor = createLatexEditor(document.createElement("div"), {
    doc: "",
    onChange: hooks.onChange,
    onCursor: hooks.onCursor,
    spell: {
      language: () => spellLanguageOf(hooks.file()),
      check: (language, words) => api.spellCheck(language, words),
      suggest: (language, word) => api.spellSuggest(language, word),
      add: (_language, word) => api.spellAdd(word),
      labels: {
        add: m.spell_add(),
        ignore: m.spell_ignore(),
        none: m.spell_no_suggestions(),
        loading: m.spell_loading(),
      },
    },
    completionData: () => ({
      labels: project.scan?.labels ?? [],
      citations: project.scan?.citations ?? [],
      packages: packages.catalog.map((p) => p.name),
    }),
    onEdit: (actor, depth, key) => actions.edited(actor, depth, key),
    reviewLabels: {
      accept: m.review_accept(),
      reject: m.review_reject(),
      acceptTitle: m.review_accept_title(),
      rejectTitle: m.review_reject_title(),
    },
    onReview: (key, sections, text, original) => review.report(key, sections, text, original),
    // One search over all the project's files, in place of CodeMirror's for the shown one.
    search: {
      panel: (view) => {
        const dom = view.dom.ownerDocument.createElement("div");
        const bar = mount(SearchBar, { target: dom, props: { view, file: hooks.file } });
        return { dom, update: (update) => bar.update(update), destroy: () => void unmount(bar) };
      },
      open: (view) => projectSearch.open(view),
      step: (view, back) => {
        const { from, to } = view.state.selection.main;
        void projectSearch.step(hooks.file(), from, to, back);
      },
    },
    lineAction: {
      label: () => m.editor_line_to_pdf(),
      // SyncTeX knows the lines of .tex files that went into the last PDF.
      available: () => Boolean(build.lastResult?.pdfPath) && (hooks.file()?.toLowerCase().endsWith(".tex") ?? false),
      run: (line) => hooks.syncToPdf(line),
    },
    shortcuts: {
      // Through the timeline, so undo reaches edits in other files and by assistants too.
      "Mod-z": () => (void actions.undo("user"), true),
      "Mod-y": () => (void actions.redo("user"), true),
      "Mod-Shift-z": () => (void actions.redo("user"), true),
      "Mod-s": () => (void doc.save(), true),
      "Mod-Enter": () => (void build.compile(), true),
      "Mod-Alt-j": () => (hooks.syncToPdf(), true),
      // "+" covers German layouts and the numpad, "=" the unshifted key on US layouts.
      "Mod-+": () => (setEditorZoom(zoom() + 0.1), true),
      "Mod-=": () => (setEditorZoom(zoom() + 0.1), true),
      "Mod--": () => (setEditorZoom(zoom() - 0.1), true),
      "Mod-0": () => (setEditorZoom(1), true),
    },
  });
  editor.setZoom(zoom());
  // Follows the UI language; an open search panel shows the new one when opened again.
  const stop = $effect.root(() => {
    $effect(() => editor.setPhrases(phrases()));
  });
  const destroy = editor.destroy;
  editor.destroy = () => {
    stop();
    destroy();
  };
  return editor;
}

/**
 * The main editor, with a tab per open file. It outlives the editor pane,
 * which is closed, docked and detached into windows of its own; each time the
 * pane mounts it takes the editor over with undo history and cursor intact.
 */
export function sharedEditor(): LatexEditor {
  if (doc.editor) return doc.editor;
  const editor = buildEditor({
    onChange: (text) => build.onEditorChange(text),
    onCursor: (before, selected) => formatting.onCursor(before, selected),
    file: () => project.file,
    syncToPdf: (line) => void doc.syncToPdf(project.file, line),
  });
  if (project.file) editor.load(project.file, project.text);
  doc.editor = editor;
  return editor;
}

/** An editor for a single file in a window of its own, saving through `buffer`. */
export function fileEditor(buffer: FileBuffer): LatexEditor {
  return buildEditor({
    onChange: (text) => buffer.setText(text),
    file: () => buffer.path,
    syncToPdf: (line) => void doc.syncToPdf(buffer.path, line),
  });
}
