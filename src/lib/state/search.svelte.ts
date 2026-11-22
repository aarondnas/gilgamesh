// The search bar's state (Ctrl+F): one search over all text files of the
// project, shared by the editors' bars. Switching files shows another
// editor state, whose bar is made anew; query, options and hits stay here,
// so stepping on from the last hit of one file into the next one just works.
import { openSearchPanel, SearchQuery, searchPanelOpen, setSearchQuery } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { errorMessage } from "$lib/api";
import { m } from "$lib/paraglide/messages";
import { hitsIn, MAX_HITS, patternOf, replacementOf, type SearchHit, type SearchOptions } from "$lib/util/project-search";
import { actions } from "./actions.svelte";
import { build } from "./build.svelte";
import { doc } from "./document.svelte";
import { project } from "./project.svelte";

/** After typing stops, before searching again. */
const DELAY = 200;
/** A longer selection is no search term. */
const MAX_ADOPTED = 100;

class ProjectSearch {
  query = $state("");
  replacement = $state("");
  regex = $state(false);
  caseSensitive = $state(false);
  wholeWord = $state(false);
  hits = $state.raw<SearchHit[]>([]);
  /** More hits than counted. */
  capped = $state(false);
  /** An invalid regular expression. */
  error = $state<string | null>(null);
  /** What the last "replace all" did, until the query changes. */
  notice = $state<string | null>(null);

  options = $derived<SearchOptions>({
    query: this.query,
    regex: this.regex,
    caseSensitive: this.caseSensitive,
    wholeWord: this.wholeWord,
  });
  files = $derived(new Set(this.hits.map((h) => h.file)).size);

  /** The bars shown, each with how it takes the focus. */
  #bars = new Map<EditorView, () => void>();
  /** The next bar to show takes the focus (it comes with another file's state). */
  #focusNext = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<void> | null = null;
  #generation = 0;

  /** A bar was shown; returns its removal. Takes the focus if one was asked for. */
  register(view: EditorView, focus: () => void): () => void {
    this.#bars.set(view, focus);
    if (this.#focusNext) {
      this.#focusNext = false;
      focus();
    }
    return () => this.#bars.delete(view);
  }

  /** The query as CodeMirror's, so the shown file's hits light up. */
  highlight(view: EditorView) {
    const query = new SearchQuery({
      search: this.query,
      caseSensitive: this.caseSensitive,
      regexp: this.regex,
      wholeWord: this.wholeWord,
    });
    view.dispatch({ effects: setSearchQuery.of(query) });
  }

  /** Ctrl+F: the bar of `view` opens (or takes the focus), with the selected word as query. */
  open(view: EditorView) {
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    if (selected && selected.length <= MAX_ADOPTED && !selected.includes("\n")) this.query = selected;
    const focus = this.#bars.get(view);
    if (focus && searchPanelOpen(view.state)) focus();
    else {
      this.#focusNext = true;
      openSearchPanel(view);
    }
  }

  /** Searches again a moment from now (typing), or at once. */
  schedule(delay = DELAY) {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#search();
    }, delay);
  }

  async #search() {
    const generation = ++this.#generation;
    const run = (async () => {
      try {
        const found = await this.#find($state.snapshot(this.options));
        if (generation !== this.#generation) return;
        this.hits = found.hits;
        this.capped = found.capped;
        this.error = null;
      } catch (err) {
        if (generation !== this.#generation) return;
        this.hits = [];
        this.capped = false;
        this.error = errorMessage(err);
      }
    })();
    this.#running = run;
    await run;
  }

  /** The hits as they are now: a search still waiting (typing) or running is finished first. */
  async #current(): Promise<SearchHit[]> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
      await this.#search();
    } else if (this.#running) await this.#running;
    return this.hits;
  }

  /** The position of the hit that `from`…`to` in `file` is, -1 for none. */
  indexOf(file: string | null, from: number, to: number): number {
    return this.hits.findIndex((h) => h.file === file && h.from === from && h.to === to);
  }

  /**
   * Shows the hit after (or before) `from`…`to` in `file`, in the project's
   * file order and round at the end; another file opens for it.
   */
  async step(file: string | null, from: number, to: number, back: boolean) {
    const hits = await this.#current();
    if (!hits.length) return;
    const files = project.textFiles();
    const rank = (path: string | null) => (path ? files.indexOf(path) : -1);
    const here = rank(file);
    const target = back
      ? (hits.findLast((h) => (h.file === file && h.to <= from) || rank(h.file) < here) ?? hits.at(-1)!)
      : (hits.find((h) => (h.file === file && h.from >= to) || rank(h.file) > here) ?? hits[0]);
    if (target.file !== file) this.#focusNext = true;
    await doc.showRange(target.file, target.from, target.to);
  }

  /** Replaces the hit `from`…`to` in `file` and shows the next one; elsewhere only shows the next one, as CodeMirror does. */
  async replace(file: string | null, from: number, to: number) {
    await this.#current();
    const hit = this.hits[this.indexOf(file, from, to)];
    if (!hit) return this.step(file, from, to, false);
    const pattern = patternOf(this.options);
    if (!(pattern instanceof RegExp)) return;
    const length = replacementOf(hit, pattern, this.replacement, this.regex).length;
    await this.#replace($state.snapshot(this.options), this.replacement, hit);
    await this.#search();
    const end = hit.from + length;
    await this.step(file, end, end, false);
  }

  /** Every hit in every file; each file's change can be undone with Ctrl+Z. */
  async replaceAll() {
    await this.#current();
    if (!this.hits.length) return;
    const count = await this.#replace($state.snapshot(this.options), this.replacement);
    await this.#search();
    this.notice = m.search_replaced({ count });
  }

  #pattern(options: SearchOptions): RegExp | null {
    const pattern = patternOf(options);
    if (pattern instanceof Error) throw new Error(m.search_invalid({ error: pattern.message }));
    return pattern;
  }

  /** The hits of `options` in all of the project's text files, at most `MAX_HITS`. Errors propagate to the bar. */
  async #find(options: SearchOptions): Promise<{ hits: SearchHit[]; capped: boolean }> {
    const pattern = this.#pattern(options);
    if (!pattern) return { hits: [], capped: false };
    const hits: SearchHit[] = [];
    for (const [file, text] of await project.texts()) {
      hits.push(...hitsIn(file, text, pattern, MAX_HITS - hits.length));
      if (hits.length >= MAX_HITS) return { hits, capped: true };
    }
    return { hits, capped: false };
  }

  /**
   * Replaces the hits of `options` by `replacement` (with `$1` and the like
   * for a regular expression): all of them, or the one `only` names. Each
   * file's change is one step Ctrl+Z takes back. Returns how many it replaced.
   */
  async #replace(options: SearchOptions, replacement: string, only?: SearchHit): Promise<number> {
    const pattern = this.#pattern(options);
    if (!pattern) return 0;
    let count = 0;
    for (const [file, text] of await project.texts()) {
      if (only && only.file !== file) continue;
      const hits = hitsIn(file, text, pattern, Number.MAX_SAFE_INTEGER).filter((h) => !only || (h.from === only.from && h.to === only.to));
      if (!hits.length) continue;
      let next = text;
      for (const hit of [...hits].reverse())
        next = next.slice(0, hit.from) + replacementOf(hit, pattern, replacement, options.regex) + next.slice(hit.to);
      // The whole span at once, so the file's change is a single step.
      const from = hits[0].from;
      const tail = text.length - hits.at(-1)!.to;
      await actions.replaceText("user", file, from, text.length - tail, next.slice(from, next.length - tail));
      count += hits.length;
    }
    if (count) void build.compile();
    return count;
  }
}

export const projectSearch = new ProjectSearch();
