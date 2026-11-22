// LaTeX-aware spell checking for CodeMirror: marks unknown words and offers
// suggestions in an overlay on hover and on right click. The dictionary
// lookup itself is injected.
import { RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, hoverTooltip, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { tokenize } from "../latex/tokenize";

export interface SpellOptions {
  /** Dictionary code ("de", "en-GB", …) or `null` to switch checking off. */
  language: () => string | null;
  /** Returns the words the dictionary does not know. */
  check: (language: string, words: string[]) => Promise<string[]>;
  suggest: (language: string, word: string) => Promise<string[]>;
  /** Adds the word to the installation's own dictionary. */
  add: (language: string, word: string) => Promise<void>;
  labels: { add: string; ignore: string; none: string; loading: string };
}

const CHECK_DELAY = 400;
const HOVER_DELAY = 350;

const setMisspelled = StateEffect.define<DecorationSet>();
/** Asks the checker to run again, e.g. after the language or the user's dictionary changed. */
export const refreshSpelling = StateEffect.define<{ forget: boolean }>();

const mark = Decoration.mark({ class: "cm-misspelled" });

const misspelledField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setMisspelled)) return effect.value;
    return value.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The marked word around `pos`, if any. */
function misspelledAt(view: EditorView, pos: number): { from: number; to: number } | null {
  let hit: { from: number; to: number } | null = null;
  view.state.field(misspelledField).between(pos, pos, (from, to) => {
    hit = { from, to };
  });
  return hit;
}

const theme = EditorView.baseTheme({
  ".cm-misspelled": {
    textDecoration: "underline wavy var(--error, #c42b1c)",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
  },
  ".cm-spell-actions": {
    display: "flex",
    flexDirection: "column",
    minWidth: "180px",
    padding: "4px 0",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-md, 13px)",
  },
  ".cm-spell-actions button": {
    padding: "4px 12px",
    border: "none",
    background: "none",
    color: "var(--text)",
    font: "inherit",
    textAlign: "left",
  },
  ".cm-spell-actions button:hover": { background: "var(--hover)" },
  ".cm-spell-actions .suggestion": { fontWeight: "600" },
  ".cm-spell-actions .muted": { color: "var(--text-muted)" },
  ".cm-spell-actions hr": { margin: "4px 0", border: "none", borderTop: "1px solid var(--border)" },
  ".cm-spell-menu": {
    position: "fixed",
    zIndex: "20",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    background: "var(--surface)",
    boxShadow: "0 4px 16px rgb(0 0 0 / 0.15)",
  },
});

export function spellChecking(options: SpellOptions): Extension {
  /** Per language: word → known. Survives edits, so only new words are looked up. */
  const known = new Map<string, Map<string, boolean>>();
  const ignored = new Set<string>();
  let checker: SpellPlugin | null = null;

  /**
   * Suggestions plus "add" and "ignore" for `word`, used by the hover overlay
   * and the context menu. `done` closes the surrounding overlay.
   */
  function actions(view: EditorView, from: number, to: number, done: () => void): HTMLElement {
    const language = options.language();
    const word = view.state.sliceDoc(from, to);
    // The editor may be shown in a detached window with a document of its own.
    const document = view.dom.ownerDocument;
    const box = document.createElement("div");
    box.className = "cm-spell-actions";
    const button = (label: string, action: () => void, className = "") => {
      const b = document.createElement("button");
      b.textContent = label;
      b.className = className;
      b.onmousedown = (e) => e.preventDefault(); // Keep the editor's selection and focus.
      b.onclick = () => {
        done();
        action();
      };
      return b;
    };
    const status = button(options.labels.loading, () => {}, "muted");
    box.append(status, document.createElement("hr"));
    box.append(
      button(options.labels.add, () => {
        if (!language) return;
        known.get(language)?.set(word, true);
        checker?.schedule(0);
        void options.add(language, word);
      }),
      button(options.labels.ignore, () => {
        ignored.add(word);
        checker?.schedule(0);
      }),
    );
    if (language) {
      void options
        .suggest(language, word)
        .catch(() => [])
        .then((suggestions) => {
          if (suggestions.length === 0) {
            status.textContent = options.labels.none;
            return;
          }
          status.replaceWith(
            ...suggestions.map((s) =>
              button(s, () => view.dispatch({ changes: { from, to, insert: s }, userEvent: "input.spell" }), "suggestion"),
            ),
          );
        });
    }
    return box;
  }

  class SpellPlugin {
    timer: ReturnType<typeof setTimeout> | undefined;
    generation = 0;
    menu: HTMLElement | null = null;
    readonly view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      checker = this;
      this.schedule();
    }

    update(update: ViewUpdate) {
      let refresh = false;
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (!effect.is(refreshSpelling)) continue;
          refresh = true;
          if (effect.value.forget) known.clear();
        }
      }
      if (update.docChanged || refresh) this.schedule(refresh ? 0 : CHECK_DELAY);
    }

    schedule(delay = CHECK_DELAY) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.run(), delay);
    }

    async run() {
      const generation = ++this.generation;
      const language = options.language();
      if (!language) {
        this.view.dispatch({ effects: setMisspelled.of(Decoration.none) });
        return;
      }
      const cache = known.get(language) ?? new Map<string, boolean>();
      known.set(language, cache);
      const tokens = tokenize(this.view.state.doc.toString());
      const unknown = [...new Set(tokens.map((t) => t.word).filter((w) => !cache.has(w)))];
      if (unknown.length > 0) {
        try {
          const wrong = new Set(await options.check(language, unknown));
          for (const word of unknown) cache.set(word, !wrong.has(word));
        } catch {
          return; // No dictionary (offline): leave the text unmarked.
        }
      }
      // The text may have changed while the dictionary answered.
      if (generation !== this.generation) return;
      const builder = new RangeSetBuilder<Decoration>();
      for (const t of tokens) if (cache.get(t.word) === false && !ignored.has(t.word)) builder.add(t.from, t.to, mark);
      this.view.dispatch({ effects: setMisspelled.of(builder.finish()) });
    }

    openMenu(event: MouseEvent, from: number, to: number) {
      this.closeMenu();
      const menu = actions(this.view, from, to, () => this.closeMenu());
      menu.classList.add("cm-spell-menu");
      menu.style.left = `${event.clientX}px`;
      menu.style.top = `${event.clientY}px`;
      // Inside the editor's DOM so the base theme applies.
      this.view.dom.append(menu);
      this.menu = menu;
      const close = (e: Event) => {
        // No `instanceof Node`: nodes of a detached window come from another realm.
        if (!menu.contains(e.target as Node | null)) this.closeMenu();
      };
      const win = this.view.dom.ownerDocument.defaultView ?? window;
      setTimeout(() => {
        win.addEventListener("mousedown", close, { once: true });
        win.addEventListener("keydown", close, { once: true });
      });
    }

    closeMenu() {
      this.menu?.remove();
      this.menu = null;
    }

    destroy() {
      clearTimeout(this.timer);
      this.closeMenu();
      if (checker === this) checker = null;
    }
  }

  const plugin = ViewPlugin.fromClass(SpellPlugin, {
    eventHandlers: {
      contextmenu(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        const hit = pos === null ? null : misspelledAt(view, pos);
        if (!hit) return false;
        event.preventDefault();
        this.openMenu(event, hit.from, hit.to);
        return true;
      },
    },
  });

  // The overlay at the marked word itself.
  const hover = hoverTooltip(
    (view, pos) => {
      // Not while selecting: the overlay would pop up mid-drag. Right click still offers it.
      if (!view.state.selection.main.empty) return null;
      const hit = misspelledAt(view, pos);
      if (!hit) return null;
      return {
        pos: hit.from,
        end: hit.to,
        above: false,
        create: (view) => {
          let dom: HTMLElement;
          // Closing: drop the tooltip by moving the hover state, simplest via a no-op dispatch.
          const done = () => {
            dom.style.display = "none";
          };
          dom = actions(view, hit.from, hit.to, done);
          return { dom };
        },
      };
    },
    { hoverTime: HOVER_DELAY },
  );

  return [misspelledField, plugin, hover, theme];
}
