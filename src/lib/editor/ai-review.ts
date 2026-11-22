// Review of changes made by AI assistants (or any interface other than the
// user), as in GitHub Copilot: their edits go into the text at once, so the
// PDF shows them, but stay marked until the user accepts or rejects them,
// section by section. The text from before the first such edit is kept as the
// original; what differs from it is shown: added lines blue, removed ones
// red above them, each section with "Accept" and "Reject" below it on the left.
// What the user types outside the marked sections goes into the original too,
// so it never shows up as the assistant's.
//
// An assistant's change does not just pop up: its new text is written in line
// by line, from top to bottom, each line from left to right, the removed lines
// fade in above it and the buttons follow once it is all there. Settling a
// section is animated too: accepted, its blue fades and what was removed folds
// away; rejected, the earlier text loses its red and strike-through while the
// assistant's text folds away. The text is in the document at once (or back
// at once); only its display is animated.
import { Chunk } from "@codemirror/merge";
import { isolateHistory } from "@codemirror/commands";
import {
  ChangeSet,
  EditorState,
  Facet,
  Prec,
  StateEffect,
  StateField,
  Text,
  type Range,
  type StateEffectType,
  type Transaction,
} from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from "@codemirror/view";
import { prefersReducedMotion } from "$lib/util/motion";

/** A section awaiting review, by 1-based lines of the current text. */
export interface ReviewSection {
  line: number;
  endLine: number;
}

export interface ReviewOptions {
  /** Whether a transaction comes from an assistant (or any interface but the user). */
  fromAssistant: (tr: Transaction) => boolean;
  labels: { accept: string; reject: string; acceptTitle: string; rejectTitle: string };
}

interface Review {
  /** The text as it was before the assistant's edits; `null` when nothing awaits review. */
  original: Text | null;
  chunks: readonly Chunk[];
}

const NONE: Review = { original: null, chunks: [] };

/** The options, kept with each document's state, so they travel with it to another editor. */
const optionsFacet = Facet.define<ReviewOptions, ReviewOptions | null>({
  combine: (values) => values[0] ?? null,
});

/** Accepts the section starting at this position of the current text. */
const acceptSection = StateEffect.define<number>();
const acceptEverything = StateEffect.define<null>();
/** Opens a review with this original, e.g. one kept from before a restart. */
const restoreOriginal = StateEffect.define<string>();

/** The parts of `chunks` that an edit from `from` to `to` touches. */
function touches(chunks: readonly Chunk[], from: number, to: number) {
  return chunks.some((c) => (from < c.toB && to > c.fromB) || (from === to && from > c.fromB && from < c.toB));
}

/**
 * The user's edits that lie outside every section, carried over into the
 * original; edits inside a section stay part of it (and so of the review).
 */
function rebase(original: Text, chunks: readonly Chunk[], changes: ChangeSet): Text {
  const specs: { from: number; to: number; insert: Text }[] = [];
  changes.iterChanges((fromB, toB, _fromNew, _toNew, inserted) => {
    if (touches(chunks, fromB, toB)) return;
    // Positions before the edit shift by what the sections before it add or remove.
    let shift = 0;
    for (const c of chunks) if (c.toB <= fromB) shift += c.toA - c.fromA - (c.toB - c.fromB);
    specs.push({ from: fromB + shift, to: toB + shift, insert: inserted });
  });
  return specs.length > 0 ? ChangeSet.of(specs, original.length).apply(original) : original;
}

/** `text` from `from` to `to`, the end clipped: a section may end one past the last line. */
const slice = (text: Text, from: number, to: number) => text.sliceString(from, Math.min(to, text.length));

const reviewField = StateField.define<Review>({
  create: () => NONE,
  update(review, tr) {
    let original = review.original;
    if (tr.docChanged) {
      const assistant = tr.startState.facet(optionsFacet)?.fromAssistant(tr) ?? false;
      // The first of an assistant's edits opens the review; later ones join it.
      if (assistant) original ??= tr.startState.doc;
      // Only the user's own edits outside the sections go into the original. Rejecting
      // puts the original back, so it never does: a removed line comes back where its
      // section is empty, which would look like an edit outside it.
      else if (original && !tr.isUserEvent("input.revert")) original = rebase(original, review.chunks, tr.changes);
    }
    for (const effect of tr.effects) {
      if (effect.is(restoreOriginal) && !original) original = Text.of(effect.value.split("\n"));
      if (!original) continue;
      if (effect.is(acceptEverything)) original = tr.newDoc;
      if (effect.is(acceptSection)) {
        // Effects come without text changes (see `accept`), so positions still hold.
        const c = review.chunks.find((chunk) => chunk.fromB === effect.value);
        if (c) {
          const taken = slice(tr.startState.doc, c.fromB, c.toB);
          original = Text.of(
            (original.sliceString(0, c.fromA) + taken + original.sliceString(Math.min(c.toA, original.length))).split("\n"),
          );
        }
      }
    }
    if (!original) return NONE;
    if (original === review.original && !tr.docChanged) return review;
    const chunks = Chunk.build(original, tr.newDoc);
    // All sections accepted or rejected: nothing awaits review any more.
    return chunks.length > 0 ? { original, chunks } : NONE;
  },
});

/** Takes the section starting at `fromB` into the original. */
function accept(view: EditorView, fromB: number) {
  const review = view.state.field(reviewField);
  const c = review.chunks.find((chunk) => chunk.fromB === fromB);
  view.dispatch({ effects: [acceptSection.of(fromB), ...departing(acceptance(view.state, review, c ? [c] : []))] });
}

/** Puts the original text of the section starting at `fromB` back, as one undoable step. */
function reject(view: EditorView, fromB: number) {
  const review = view.state.field(reviewField);
  const { original, chunks } = review;
  const c = chunks.find((chunk) => chunk.fromB === fromB);
  if (!original || !c) return;
  view.dispatch({
    changes: { from: c.fromB, to: Math.min(c.toB, view.state.doc.length), insert: slice(original, c.fromA, c.toA) },
    effects: departing(rejection(view.state, review, [c], (chunk) => chunk.fromB)),
    annotations: isolateHistory.of("full"),
    userEvent: "input.revert",
  });
}

/** Where a section's buttons go: below its last line, or where its removed text was. */
const controlsAt = (doc: Text, c: Chunk) => (c.toB > c.fromB ? doc.lineAt(c.endB).to : Math.min(c.fromB, doc.length));

/**
 * Ends a passing animation once it is over (`ms` after its last start), so
 * lines CodeMirror draws anew later, e.g. when scrolling, do not play it again.
 */
function endAfter<T extends { count: number }>(field: StateField<T>, idle: (value: T) => boolean, end: StateEffectType<null>, ms: number) {
  return ViewPlugin.define((view) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (value: T) => {
      clearTimeout(timer);
      if (!idle(value)) timer = setTimeout(() => view.dispatch({ effects: end.of(null) }), ms);
    };
    schedule(view.state.field(field));
    return {
      update(update) {
        const value = update.state.field(field);
        if (value.count !== update.startState.field(field).count) schedule(value);
      },
      destroy: () => clearTimeout(timer),
    };
  });
}

/** How long settled sections take to look like plain text again. */
const DEPART_MS = 550;
/** How long what went takes to fold away. */
const FOLD_MS = 320;

/** What went with a settled section, drawn once more where it was while it folds away. */
interface Ghost {
  pos: number;
  side: -1 | 1;
  /** Removed lines (red) that an accepted section dropped. */
  removed: string | null;
  /** Lines (blue) that a rejected section dropped. */
  inserted: string | null;
  /** The section's buttons, red for a section that only removed text. */
  controls: "plain" | "removal" | null;
}

/** Sections just accepted or rejected, by position in the current text. */
interface Departure {
  /** Lines that stay: `accepted` ones were blue, `restored` ones were the red removed text. */
  lines: readonly { from: number; to: number; kind: "accepted" | "restored" }[];
  ghosts: readonly Ghost[];
  count: number;
}

type DepartureSpec = Omit<Departure, "count">;

/** Sections settled in this transaction; positions in the text after it. */
const depart = StateEffect.define<DepartureSpec>();
const endDeparture = StateEffect.define<null>();

const departureField = StateField.define<Departure>({
  create: () => ({ lines: [], ghosts: [], count: 0 }),
  update(departure, tr) {
    if (tr.effects.some((e) => e.is(endDeparture))) departure = { lines: [], ghosts: [], count: departure.count };
    if (tr.docChanged && (departure.lines.length > 0 || departure.ghosts.length > 0)) {
      const map = (pos: number, side: number) => tr.changes.mapPos(pos, side);
      departure = {
        lines: departure.lines.map((l) => ({ ...l, from: map(l.from, -1), to: map(l.to, 1) })),
        ghosts: departure.ghosts.map((g) => ({ ...g, pos: map(g.pos, g.side) })),
        count: departure.count,
      };
    }
    for (const effect of tr.effects) {
      if (!effect.is(depart)) continue;
      departure = {
        lines: [...departure.lines, ...effect.value.lines],
        ghosts: [...departure.ghosts, ...effect.value.ghosts],
        count: departure.count + 1,
      };
    }
    return departure;
  },
});

const departureTimer = endAfter(departureField, (d) => d.lines.length === 0 && d.ghosts.length === 0, endDeparture, DEPART_MS + 200);

/** The effect announcing `spec`, none when motion is reduced. */
const departing = (spec: DepartureSpec) => (prefersReducedMotion() ? [] : [depart.of(spec)]);

/** Accepting `chunks` (the text stays): their blue fades, their removed lines and buttons fold away. */
function acceptance(state: EditorState, review: Review, chunks: readonly Chunk[]): DepartureSpec {
  const doc = state.doc;
  const lines: Departure["lines"][number][] = [];
  const ghosts: Ghost[] = [];
  for (const c of chunks) {
    if (c.toB > c.fromB) lines.push({ from: c.fromB, to: doc.lineAt(c.endB).to, kind: "accepted" });
    if (c.toA > c.fromA && review.original) {
      const removed = review.original.sliceString(c.fromA, c.endA);
      ghosts.push({ pos: c.fromB, side: -1, removed, inserted: null, controls: null });
    }
    const controls = c.toB === c.fromB ? "removal" : "plain";
    ghosts.push({ pos: controlsAt(doc, c), side: 1, removed: null, inserted: null, controls });
  }
  return { lines, ghosts };
}

/**
 * Rejecting `chunks` (their original text comes back, at `at` in the new
 * text): the earlier lines lose their red, the assistant's lines and the
 * buttons fold away below them.
 */
function rejection(state: EditorState, review: Review, chunks: readonly Chunk[], at: (c: Chunk) => number): DepartureSpec {
  const lines: Departure["lines"][number][] = [];
  const ghosts: Ghost[] = [];
  if (!review.original) return { lines, ghosts };
  for (const c of chunks) {
    const restored = slice(review.original, c.fromA, c.toA);
    const from = at(c);
    const to = from + restored.length - (restored.endsWith("\n") ? 1 : 0);
    if (restored.length > 0) lines.push({ from, to, kind: "restored" });
    const inserted = c.toB > c.fromB ? state.doc.sliceString(c.fromB, c.endB) : null;
    const controls = c.toB === c.fromB ? "removal" : "plain";
    ghosts.push({ pos: restored.length > 0 ? to : from, side: restored.length > 0 ? 1 : -1, removed: null, inserted, controls });
  }
  return { lines, ghosts };
}

/** Lines of `text` in a box of class `className`, as the removed lines are shown. */
function linesBox(text: string, className: string) {
  const box = document.createElement("div");
  box.className = className;
  for (const line of text.split("\n")) {
    const row = document.createElement("div");
    row.textContent = line || "\u200b";
    box.append(row);
  }
  return box;
}

/** The buttons below a section; `removal` colors accepting red. */
function controlsBar(labels: ReviewOptions["labels"], removal: boolean, run: (kind: "accept" | "reject") => void) {
  const bar = document.createElement("div");
  bar.className = removal ? "cm-ai-controls cm-ai-removal" : "cm-ai-controls";
  const button = (label: string, title: string, kind: "accept" | "reject") => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `cm-ai-${kind}`;
    b.textContent = label;
    b.title = title;
    // Before CodeMirror moves the cursor there.
    b.addEventListener("mousedown", (event) => event.preventDefault());
    b.addEventListener("click", () => run(kind));
    return b;
  };
  bar.append(button(labels.accept, labels.acceptTitle, "accept"), button(labels.reject, labels.rejectTitle, "reject"));
  return bar;
}

/** What a settled section dropped, folding away: its height shrinks to nothing as it fades. */
class GhostWidget extends WidgetType {
  constructor(
    readonly ghost: Ghost,
    readonly labels: ReviewOptions["labels"],
  ) {
    super();
  }

  eq(other: GhostWidget) {
    const a = this.ghost;
    const b = other.ghost;
    return a.removed === b.removed && a.inserted === b.inserted && a.controls === b.controls;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-ai-ghost";
    wrap.setAttribute("aria-hidden", "true");
    const { removed, inserted, controls } = this.ghost;
    if (removed !== null) wrap.append(linesBox(removed, "cm-ai-removed"));
    if (inserted !== null) wrap.append(linesBox(inserted, "cm-ai-dropped"));
    if (controls) wrap.append(controlsBar(this.labels, controls === "removal", () => {}));
    // Its height is known once it is drawn; from there it folds to nothing.
    const win = view.dom.ownerDocument.defaultView ?? window;
    win.requestAnimationFrame(() => {
      if (!wrap.isConnected) return;
      wrap.animate(
        [
          { height: `${wrap.offsetHeight}px`, opacity: 1 },
          { height: "0px", opacity: 0 },
        ],
        { duration: FOLD_MS, delay: 60, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
      );
    });
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

const acceptedLine = Decoration.line({ class: "cm-ai-accepted" });
const restoredLine = Decoration.line({ class: "cm-ai-restored" });

const departureDecorations = EditorView.decorations.compute([departureField, optionsFacet], (state): DecorationSet => {
  const { lines, ghosts } = state.field(departureField);
  const options = state.facet(optionsFacet);
  if ((lines.length === 0 && ghosts.length === 0) || !options) return Decoration.none;
  const doc = state.doc;
  const ranges: Range<Decoration>[] = [];
  for (const { from, to, kind } of lines) {
    const deco = kind === "accepted" ? acceptedLine : restoredLine;
    for (let line = doc.lineAt(Math.min(from, doc.length)).number; line <= doc.lineAt(Math.min(to, doc.length)).number; line++) {
      ranges.push(deco.range(doc.line(line).from));
    }
  }
  for (const ghost of ghosts) {
    const widget = new GhostWidget(ghost, options.labels);
    ranges.push(Decoration.widget({ widget, block: true, side: ghost.side }).range(Math.min(ghost.pos, doc.length)));
  }
  return Decoration.set(ranges, true);
});

/** Delay from one line of an arriving change to the next; the last lines wait at most `MAX_STAGGER_MS`. */
const STAGGER_MS = 30;
const MAX_STAGGER_MS = 1200;
/** How long a line takes to be written in (see `.cm-ai-arrive` below). */
const WRITE_MS = 450;
/** When the animation of an arriving change is over, its marks go. */
const ARRIVAL_MS = MAX_STAGGER_MS + WRITE_MS + 600;

/** An assistant's changes that just came in: what they inserted, in the current text. */
interface Arrival {
  ranges: readonly { from: number; to: number }[];
  /** Counts the changes that came in, so each restarts the time until the marks go. */
  count: number;
}

const endArrival = StateEffect.define<null>();

const arrivalField = StateField.define<Arrival>({
  create: () => ({ ranges: [], count: 0 }),
  update(arrival, tr) {
    if (tr.effects.some((e) => e.is(endArrival))) arrival = { ranges: [], count: arrival.count };
    if (!tr.docChanged) return arrival;
    const ranges = arrival.ranges.map((r) => ({ from: tr.changes.mapPos(r.from, -1), to: tr.changes.mapPos(r.to, 1) }));
    const assistant = tr.startState.facet(optionsFacet)?.fromAssistant(tr) ?? false;
    if (!assistant || tr.isUserEvent("input.revert")) return ranges.length > 0 ? { ...arrival, ranges } : arrival;
    tr.changes.iterChanges((_fromA, _toA, from, to) => ranges.push({ from, to }));
    return { ranges, count: arrival.count + 1 };
  },
});

const arrivalTimer = endAfter(arrivalField, (a) => a.ranges.length === 0, endArrival, ARRIVAL_MS);

interface ArrivalPlan {
  /** Text that arrived and differs from the original, in pieces of one line each. */
  pieces: { from: number; to: number }[];
  /** When each line with such a piece is written in, by line number, in ms. */
  delays: Map<number, number>;
}

/**
 * What of the arrived text to write in and when: only what differs from the
 * original, so replacing a whole file animates what changed, not every line.
 */
function arrivalPlan(state: EditorState, review: Review): ArrivalPlan | null {
  const ranges = state.field(arrivalField, false)?.ranges ?? [];
  if (ranges.length === 0 || !review.original || prefersReducedMotion()) return null;
  const doc = state.doc;
  const spans: { from: number; to: number }[] = [];
  for (const c of review.chunks) {
    for (const change of c.changes) {
      const from = c.fromB + change.fromB;
      const to = Math.min(c.fromB + change.toB, doc.length);
      for (const r of ranges) {
        const a = Math.max(from, r.from);
        const b = Math.min(to, r.to);
        if (b > a) spans.push({ from: a, to: b });
      }
    }
  }
  spans.sort((x, y) => x.from - y.from);
  const pieces: { from: number; to: number }[] = [];
  const delays = new Map<number, number>();
  let end = 0;
  for (const span of spans) {
    // Overlapping ranges (two changes in a row) give one piece.
    for (let pos = Math.max(span.from, end); pos < span.to;) {
      const line = doc.lineAt(pos);
      const to = Math.min(span.to, line.to);
      if (to > pos) {
        pieces.push({ from: pos, to });
        if (!delays.has(line.number)) delays.set(line.number, Math.min(delays.size * STAGGER_MS, MAX_STAGGER_MS));
      }
      pos = line.to + 1;
    }
    end = Math.max(end, span.to);
  }
  return { pieces, delays };
}

/** Whether the section `c` takes part in the changes arriving. */
function arriving(state: EditorState, c: Chunk) {
  return state.field(arrivalField, false)?.ranges.some((r) => r.from <= c.toB && r.to >= c.fromB) ?? false;
}

const arrivingText = Decoration.mark({ class: "cm-ai-arrive" });

/** The arriving text, written in line by line; above the other marks, so each line's piece stays one. */
const arrivalDecorations = Prec.highest(
  EditorView.decorations.compute([arrivalField, reviewField], (state): DecorationSet => {
    const plan = arrivalPlan(state, state.field(reviewField));
    if (!plan) return Decoration.none;
    const ranges: Range<Decoration>[] = [];
    for (const [line, delay] of plan.delays) {
      const deco = Decoration.line({ class: "cm-ai-arrive-line", attributes: { style: `--ai-delay: ${delay}ms` } });
      ranges.push(deco.range(state.doc.line(line).from));
    }
    for (const piece of plan.pieces) ranges.push(arrivingText.range(piece.from, piece.to));
    return Decoration.set(ranges, true);
  }),
);

/** Marks a widget's element as arriving after `delay` ms; `null` for none. */
function arrive(element: HTMLElement, delay: number | null) {
  if (delay === null) return;
  element.classList.add("cm-ai-arriving");
  element.style.setProperty("--ai-delay", `${delay}ms`);
}

/** The removed lines of a section, shown above where they were. */
class RemovedWidget extends WidgetType {
  /** `delay`: when it fades in, if it is part of a change arriving; not compared, so it is not drawn anew. */
  constructor(
    readonly text: string,
    readonly delay: number | null = null,
  ) {
    super();
  }

  eq(other: RemovedWidget) {
    return other.text === this.text;
  }

  toDOM() {
    const box = linesBox(this.text, "cm-ai-removed");
    arrive(box, this.delay);
    return box;
  }

  ignoreEvent() {
    return false;
  }
}

/**
 * "Accept" and "Reject" below a section. Accepting has the section's color:
 * red when it only removes text, blue when it adds some.
 */
class ControlsWidget extends WidgetType {
  constructor(
    readonly fromB: number,
    readonly removal: boolean,
    readonly labels: ReviewOptions["labels"],
    /** When the buttons appear, if the section is arriving; not compared, as for `RemovedWidget`. */
    readonly delay: number | null = null,
  ) {
    super();
  }

  eq(other: ControlsWidget) {
    return other.fromB === this.fromB && other.removal === this.removal;
  }

  toDOM(view: EditorView) {
    const bar = controlsBar(this.labels, this.removal, (kind) => (kind === "accept" ? accept(view, this.fromB) : reject(view, this.fromB)));
    arrive(bar, this.delay);
    return bar;
  }

  ignoreEvent() {
    return true;
  }
}

const insertedLine = Decoration.line({ class: "cm-ai-inserted" });

const reviewDecorations = EditorView.decorations.compute([reviewField, arrivalField, optionsFacet], (state): DecorationSet => {
  const review = state.field(reviewField);
  const { original, chunks } = review;
  const options = state.facet(optionsFacet);
  if (!original || !options) return Decoration.none;
  const doc = state.doc;
  const plan = arrivalPlan(state, review);
  const ranges: Range<Decoration>[] = [];
  for (const c of chunks) {
    const first = doc.lineAt(Math.min(c.fromB, doc.length)).number;
    const last = c.toB > c.fromB ? doc.lineAt(c.endB).number : first;
    // Removed lines first, the buttons once the section's last line is written in.
    let removedDelay: number | null = null;
    let controlsDelay: number | null = null;
    if (plan && arriving(state, c)) {
      const delays = [...plan.delays].filter(([line]) => line >= first && line <= last).map(([, d]) => d);
      removedDelay = delays.length > 0 ? Math.min(...delays) : 0;
      controlsDelay = (delays.length > 0 ? Math.max(...delays) : 0) + WRITE_MS;
    }
    if (c.toA > c.fromA) {
      const removed = original.sliceString(c.fromA, c.endA);
      ranges.push(Decoration.widget({ widget: new RemovedWidget(removed, removedDelay), block: true, side: -1 }).range(c.fromB));
    }
    if (c.toB > c.fromB) {
      for (let line = first; line <= last; line++) ranges.push(insertedLine.range(doc.line(line).from));
    }
    const controls = new ControlsWidget(c.fromB, c.toB === c.fromB, options.labels, controlsDelay);
    ranges.push(Decoration.widget({ widget: controls, block: true, side: 1 }).range(controlsAt(doc, c)));
  }
  return Decoration.set(ranges, true);
});

const reviewTheme = EditorView.baseTheme({
  // The blue of command arguments (`--syn-atom`), red as for errors: both follow light and dark mode.
  ".cm-ai-inserted": { backgroundColor: "color-mix(in srgb, var(--syn-atom) 13%, transparent)" },
  ".cm-ai-removed": {
    padding: "0 6px 0 4px",
    backgroundColor: "color-mix(in srgb, var(--error) 12%, transparent)",
    color: "color-mix(in srgb, var(--text) 70%, var(--error))",
    textDecoration: "line-through",
    textDecorationColor: "color-mix(in srgb, var(--error) 45%, transparent)",
    whiteSpace: "pre",
  },
  ".cm-ai-controls": {
    display: "flex",
    justifyContent: "flex-start",
    gap: "4px",
    padding: "2px 6px 4px",
    fontFamily: "var(--font-ui)",
  },
  ".cm-ai-controls button": {
    padding: "1px 10px",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    background: "var(--surface)",
    color: "var(--text)",
    font: "inherit",
    fontSize: "var(--font-sm)",
    cursor: "default",
  },
  ".cm-ai-controls .cm-ai-accept": {
    borderColor: "var(--syn-atom)",
    background: "var(--syn-atom)",
    color: "var(--surface)",
  },
  ".cm-ai-controls.cm-ai-removal .cm-ai-accept": {
    borderColor: "var(--error)",
    background: "var(--error)",
  },
  ".cm-ai-controls .cm-ai-accept:hover": { filter: "brightness(1.15)" },
  ".cm-ai-controls .cm-ai-reject:hover": { background: "var(--hover)" },
  // Arriving text is uncovered from left to right by a soft edge, hidden until its line's turn.
  ".cm-ai-arrive": {
    maskImage: "linear-gradient(to right, #000 45%, transparent 55%)",
    maskSize: "250% 100%",
    maskRepeat: "no-repeat",
    animation: `cm-ai-write ${WRITE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1) var(--ai-delay, 0ms) both`,
  },
  "@keyframes cm-ai-write": {
    from: { maskPosition: "100% 0" },
    to: { maskPosition: "0 0" },
  },
  // The line lights up as it is written, then settles to the blue of added lines.
  ".cm-ai-arrive-line": { animation: "cm-ai-glow 900ms ease-out var(--ai-delay, 0ms)" },
  "@keyframes cm-ai-glow": {
    from: { backgroundColor: "color-mix(in srgb, var(--syn-atom) 32%, transparent)" },
  },
  ".cm-ai-removed.cm-ai-arriving": { animation: "cm-ai-fade 400ms ease-out var(--ai-delay, 0ms) both" },
  "@keyframes cm-ai-fade": {
    from: { opacity: "0", textDecorationColor: "transparent" },
  },
  ".cm-ai-controls.cm-ai-arriving": { animation: "cm-ai-rise 280ms ease-out var(--ai-delay, 0ms) both" },
  // Accepted: the blue lights up once and fades into plain text.
  ".cm-ai-accepted": { animation: `cm-ai-accept ${DEPART_MS}ms ease-out backwards` },
  "@keyframes cm-ai-accept": {
    from: { backgroundColor: "color-mix(in srgb, var(--syn-atom) 13%, transparent)" },
    "25%": { backgroundColor: "color-mix(in srgb, var(--syn-atom) 24%, transparent)" },
    to: { backgroundColor: "transparent" },
  },
  // Rejected: the earlier text, red and struck through until now, turns back into plain text.
  ".cm-ai-restored": { animation: `cm-ai-restore ${DEPART_MS}ms ease-out backwards` },
  "@keyframes cm-ai-restore": {
    from: {
      backgroundColor: "color-mix(in srgb, var(--error) 12%, transparent)",
      textDecorationLine: "line-through",
      textDecorationColor: "color-mix(in srgb, var(--error) 45%, transparent)",
    },
    to: {
      backgroundColor: "transparent",
      textDecorationLine: "line-through",
      textDecorationColor: "transparent",
    },
  },
  ".cm-ai-ghost": { overflow: "hidden", pointerEvents: "none" },
  // The assistant's rejected lines, struck through as they fold away.
  ".cm-ai-dropped": {
    padding: "0 6px 0 4px",
    backgroundColor: "color-mix(in srgb, var(--syn-atom) 13%, transparent)",
    color: "var(--text-muted)",
    textDecoration: "line-through",
    textDecorationColor: "color-mix(in srgb, var(--error) 60%, transparent)",
    whiteSpace: "pre",
  },
  "@keyframes cm-ai-rise": {
    from: { opacity: "0", transform: "translateY(-4px)" },
  },
});

/** What a document keeps: its original while changes await review. */
export const reviewState = reviewField;

/** How an editor shows and starts reviews; see the top of this file. */
export function aiReview(options: ReviewOptions) {
  return [
    optionsFacet.of(options),
    arrivalField,
    arrivalTimer,
    departureField,
    departureTimer,
    reviewDecorations,
    arrivalDecorations,
    departureDecorations,
    reviewTheme,
  ];
}

/** The sections awaiting review, `null` if none; the same object until they change. */
export function reviewOf(state: EditorState): Review | null {
  const review = state.field(reviewField, false);
  return review && review.original ? review : null;
}

/** Lines of `chunks` in `doc`, the current text. */
function sectionsOf(chunks: readonly Chunk[], doc: Text): ReviewSection[] {
  return chunks.map((c) => ({
    line: doc.lineAt(Math.min(c.fromB, doc.length)).number,
    endLine: doc.lineAt(Math.min(c.toB > c.fromB ? c.endB : c.fromB, doc.length)).number,
  }));
}

/** Lines of the sections awaiting review in `state`. */
export function reviewSections(state: EditorState): ReviewSection[] {
  const review = reviewOf(state);
  return review ? sectionsOf(review.chunks, state.doc) : [];
}

/** The sections `text` differs from `original` in, without an editor (files not open). */
export function sectionsBetween(original: string, text: string): ReviewSection[] {
  const doc = Text.of(text.split("\n"));
  return sectionsOf(Chunk.build(Text.of(original.split("\n")), doc), doc);
}

/** The text from before the assistant's edits, `null` when nothing awaits review. */
export function originalText(state: EditorState): string | null {
  return reviewOf(state)?.original?.toString() ?? null;
}

/** Opens a review against `original` (kept from an earlier session); no-op if one is open. */
export const restoreReview = (state: EditorState, original: string) => state.update({ effects: restoreOriginal.of(original) });

/** Accepts every section: the current text becomes the original; `animate` for a document on screen. */
export function acceptAll(state: EditorState, animate = true) {
  const review = reviewOf(state);
  const settling = animate && review ? departing(acceptance(state, review, review.chunks)) : [];
  return state.update({ effects: [acceptEverything.of(null), ...settling] });
}

/** Rejects every section: the original text comes back, as one undoable step. */
export function rejectAll(state: EditorState) {
  const review = reviewOf(state);
  if (!review?.original) return null;
  return state.update({
    changes: { from: 0, to: state.doc.length, insert: review.original },
    // The new text is the original, so each section comes back where it was there.
    effects: departing(rejection(state, review, review.chunks, (c) => c.fromA)),
    annotations: isolateHistory.of("full"),
    userEvent: "input.revert",
  });
}
