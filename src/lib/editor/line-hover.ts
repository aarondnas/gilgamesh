// The line under the mouse lights up softly, and a button right left of it
// acts on that line (Gilgamesh: shows it in the PDF). Hovering the button
// itself keeps its line lit, so the mouse can travel from the text to it.

import { Prec, RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, ViewPlugin, gutter } from "@codemirror/view";
import { prefersReducedMotion } from "$lib/util/motion";

export interface LineAction {
  /** Tooltip and accessible name of the button. */
  label: () => string;
  /** Whether the button is offered right now, e.g. only once there is a PDF. */
  available: () => boolean;
  /** `line` is 1-based. */
  run: (line: number) => void;
}

/** Start of the hovered line, mapped through edits; `null` while the mouse is elsewhere. */
const setHover = StateEffect.define<number | null>();

const hoverField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setHover)) return effect.value;
    return value !== null && tr.docChanged ? tr.changes.mapPos(value) : value;
  },
});

const hoverDecoration = EditorView.decorations.compute([hoverField], (state) => {
  const at = state.field(hoverField);
  if (at === null) return Decoration.none;
  const line = state.doc.lineAt(Math.min(at, state.doc.length));
  const cls = prefersReducedMotion() ? "cm-hoverLine" : "cm-hoverLine cm-hoverLine-glow";
  return Decoration.set([Decoration.line({ class: cls }).range(line.from)]);
});

/** Follows the mouse over text and gutters; scrolling under a still mouse counts too. */
const tracker = ViewPlugin.fromClass(
  class {
    #last: { x: number; y: number; target: EventTarget | null } | null = null;
    readonly #move = (event: MouseEvent) => {
      this.#last = { x: event.clientX, y: event.clientY, target: event.target };
      this.#update();
    };
    readonly #leave = () => {
      this.#last = null;
      this.#set(null);
    };
    readonly #scroll = () => this.#update();

    constructor(readonly view: EditorView) {
      view.dom.addEventListener("mousemove", this.#move);
      view.dom.addEventListener("mouseleave", this.#leave);
      view.scrollDOM.addEventListener("scroll", this.#scroll, { passive: true });
    }

    #update() {
      const last = this.#last;
      if (!last) return;
      // Panels (search) and tooltips lie over the text without belonging to a line.
      const over = last.target instanceof Element ? last.target.closest(".cm-panels, .cm-tooltip") : null;
      const height = last.y - this.view.documentTop;
      const end = this.view.lineBlockAt(this.view.state.doc.length).bottom;
      if (over || height < 0 || height > end) return this.#set(null);
      this.#set(this.view.lineBlockAtHeight(height).from);
    }

    #set(at: number | null) {
      const current = this.view.state.field(hoverField, false);
      if (current === undefined) return;
      const same = current === at || (current !== null && at !== null && this.view.state.doc.lineAt(current).from === at);
      if (!same) this.view.dispatch({ effects: setHover.of(at) });
    }

    destroy() {
      this.view.dom.removeEventListener("mousemove", this.#move);
      this.view.dom.removeEventListener("mouseleave", this.#leave);
      this.view.scrollDOM.removeEventListener("scroll", this.#scroll);
    }
  },
);

/** Lucide's "locate" icon, as in the rest of the app. */
const LOCATE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/></svg>';

class ActionMarker extends GutterMarker {
  constructor(
    readonly label: string,
    /** The spacer only reserves the gutter's width; it shows nothing. */
    readonly visible = true,
  ) {
    super();
  }

  eq(other: ActionMarker) {
    return other.label === this.label && other.visible === this.visible;
  }

  toDOM(view: EditorView) {
    // The editor may live in another window's document.
    const button = view.dom.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "cm-lineAction";
    button.title = this.label;
    button.setAttribute("aria-label", this.label);
    button.innerHTML = LOCATE_ICON;
    if (!this.visible) button.style.visibility = "hidden";
    return button;
  }
}

/** Low precedence puts it after the other gutters (line numbers, folding, lint): right at the text. */
function actionGutter(action: LineAction): Extension {
  return Prec.low(
    gutter({
      class: "cm-lineActionGutter",
      markers(view) {
        const at = view.state.field(hoverField);
        if (at === null || !action.available()) return RangeSet.empty;
        return RangeSet.of([new ActionMarker(action.label()).range(view.state.doc.lineAt(at).from)]);
      },
      initialSpacer: () => new ActionMarker("", false),
      domEventHandlers: {
        mousedown(view, block, event) {
          if (!(event.target instanceof Element) || !event.target.closest(".cm-lineAction")) return false;
          // Keeps the cursor and selection where they are.
          event.preventDefault();
          action.run(view.state.doc.lineAt(block.from).number);
          return true;
        },
      },
    }),
  );
}

const hoverTheme = EditorView.theme({
  ".cm-hoverLine": { backgroundColor: "color-mix(in srgb, var(--accent-strong) 4.5%, transparent)" },
  // Lights up a little brighter first, then settles.
  ".cm-hoverLine-glow": { animation: "cm-hover-glow 450ms ease-out" },
  "@keyframes cm-hover-glow": {
    from: { backgroundColor: "transparent" },
    "35%": { backgroundColor: "color-mix(in srgb, var(--accent-strong) 9%, transparent)" },
  },
  ".cm-lineActionGutter .cm-gutterElement": { display: "flex", alignItems: "center", justifyContent: "center" },
  ".cm-lineAction": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "18px",
    height: "18px",
    margin: "0 2px",
    padding: "0",
    border: "none",
    borderRadius: "var(--radius-sm, 4px)",
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
    animation: "cm-hover-action 200ms ease-out",
  },
  ".cm-lineAction:hover": { backgroundColor: "var(--hover)", color: "var(--text)" },
  "@keyframes cm-hover-action": {
    from: { opacity: "0", transform: "scale(0.8)" },
  },
  "@media (prefers-reduced-motion: reduce)": {
    ".cm-lineAction": { animation: "none" },
  },
});

/** Hover highlighting, and with `action` its button left of the line. */
export function lineHover(action?: LineAction): Extension {
  return [hoverField, hoverDecoration, tracker, hoverTheme, ...(action ? [actionGutter(action)] : [])];
}
