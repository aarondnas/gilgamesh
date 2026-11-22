<script lang="ts" module>
  import { SvelteSet } from "svelte/reactivity";

  /** Folded headings (see `keys`); kept while the explorer switches between files and outline. */
  const collapsed = new SvelteSet<string>();
</script>

<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { canDrop, partOf, spanOf, type Part } from "$lib/latex/outline-move";
  import { m } from "$lib/paraglide/messages";
  import { changes, sectionsChanged } from "$lib/state/changes.svelte";
  import { doc } from "$lib/state/document.svelte";
  import { build } from "$lib/state/build.svelte";
  import { project } from "$lib/state/project.svelte";

  const INDENT = 12;

  const outline = $derived(project.scan?.outline ?? []);
  // Indent relative to the top level used, so an article starts at sections.
  const minLevel = $derived(Math.min(...outline.map((h) => h.level)));

  /**
   * A key per heading that survives edits elsewhere (line numbers would not):
   * file, level and title, numbered when the same heading occurs twice.
   */
  const keys = $derived.by(() => {
    const seen = new Map<string, number>();
    return outline.map((h) => {
      const base = `${h.file}\n${h.level}\n${h.title}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return `${base}\n${n}`;
    });
  });

  /** Each heading's parent: the nearest heading before it on a higher level. */
  const parents = $derived.by(() => {
    const stack: number[] = [];
    return outline.map((h, i) => {
      while (stack.length > 0 && outline[stack.at(-1)!].level >= h.level) stack.pop();
      const parent = stack.at(-1) ?? null;
      stack.push(i);
      return parent;
    });
  });

  const hasChildren = $derived(outline.map((_, i) => parents[i + 1] === i));

  /** Lookahead when matching headings to the table of contents: entries of lists etc. lie between. */
  const MATCH_WINDOW = 8;

  /**
   * Each heading's entry in the last build's table of contents, matched by title
   * in document order: its number as the PDF prints it (also roman ones, or
   * appendix letters) and its page. Headings LaTeX does not list (below
   * `tocdepth`, `\section*` without `\addcontentsline`) have none.
   */
  const printed = $derived.by(() => {
    const entries = build.contents.map((e) => ({ ...e, key: comparable(e.title) }));
    let next = 0;
    return outline.map((heading) => {
      const key = comparable(heading.title);
      const end = Math.min(entries.length, next + MATCH_WINDOW);
      for (let j = next; j < end; j++) {
        if (entries[j].key !== key) continue;
        next = j + 1;
        return entries[j];
      }
      return null;
    });
  });

  /**
   * A title without LaTeX: `Caf\'e` and "Cafe", `\emph {New} ideas` and
   * "new ideas" compare equal, accents and case aside.
   */
  function comparable(title: string): string {
    return title
      .replace(/\\[^a-zA-Z@\s]/g, "")
      .replace(/\\[a-zA-Z@]+\*?/g, " ")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  /** Shown unless a heading above it is folded. */
  const visible = $derived(
    outline.map((_, i) => {
      for (let p = parents[i]; p !== null; p = parents[p]) if (collapsed.has(keys[p])) return false;
      return true;
    }),
  );

  /**
   * Sections changed a moment ago away from the editor (see `changes`); a
   * folded one shows on the nearest heading above it that is shown.
   */
  const changed = $derived.by(() => {
    const shownRows = new Set<number>();
    if (!project.scan || changes.marks.length === 0) return shownRows;
    for (let i of sectionsChanged(project.scan, changes.marks)) {
      while (!visible[i] && parents[i] !== null) i = parents[i]!;
      shownRows.add(i);
    }
    return shownRows;
  });

  /** The heading being dragged, and where it would go: before that heading, `outline.length` behind the last. */
  let dragging = $state<number | null>(null);
  let dropAt = $state<number | null>(null);
  /** Where the appendix begins: which side of its line the drop is on. */
  let dropPart = $state<Part | undefined>(undefined);
  /** The last heading shown, below which the line for "behind the last" appears. */
  const lastVisible = $derived(visible.lastIndexOf(true));
  /** Where `\appendix` stands: its line is drawn before this heading (or behind all). */
  const appendix = $derived(project.scan?.appendix ?? null);

  /**
   * Where a drop on row `i` puts the heading: before it in the row's upper
   * half, else after it, and after all below it when they are folded. At the
   * appendix's line, a row above it means the end of the main part, a row
   * below it the start of the appendix.
   */
  function dropTarget(event: DragEvent, i: number): { target: number; part: Part | undefined } {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const target = event.clientY < rect.top + rect.height / 2 ? i : collapsed.has(keys[i]) ? spanOf(outline, i) : i + 1;
    return { target, part: target === appendix?.index ? partOf(appendix, i) : undefined };
  }

  /** On the appendix's line itself: its upper half is the main part's end, its lower half the appendix's start. */
  function lineTarget(event: DragEvent): { target: number; part: Part } {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { target: appendix!.index, part: event.clientY < rect.top + rect.height / 2 ? "main" : "appendix" };
  }

  function onDragOver(event: DragEvent, drop: { target: number; part: Part | undefined }) {
    if (dragging === null) return;
    if (!canDrop(outline, dragging, drop.target, appendix, drop.part)) {
      dropAt = null;
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dropAt = drop.target;
    dropPart = drop.part;
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    const from = dragging;
    const target = dropAt;
    const part = dropPart;
    endDrag();
    if (from !== null && target !== null) void doc.moveHeading(from, target, part);
  }

  function endDrag() {
    dragging = dropAt = null;
    dropPart = undefined;
  }

  /** The line for a drop at the appendix is drawn at the appendix's line, not at a row. */
  const atAppendix = (target: number | null) => appendix !== null && target === appendix.index;

  function toggle(i: number) {
    const key = keys[i];
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
  }
</script>

<nav class="outline">
  {#each outline as heading, i (keys[i])}
    {#if appendix?.index === i}{@render appendixLine()}{/if}
    {#if visible[i]}
      {@const open = !collapsed.has(keys[i])}
      <!-- As the PDF prints it once built; before, as LaTeX's rules give it. -->
      {@const number = printed[i] ? printed[i].number : heading.number}
      <div
        class="row"
        class:top={heading.level === minLevel}
        class:changed={changed.has(i)}
        class:dragging={dragging !== null && i >= dragging && i < spanOf(outline, dragging)}
        class:drop-before={dropAt === i && !atAppendix(i)}
        class:drop-after={dropAt === outline.length && i === lastVisible && !atAppendix(outline.length)}
        style:padding-left="{(heading.level - minLevel) * INDENT + 4}px"
        role="listitem"
        draggable="true"
        title={m.outline_drag_hint()}
        ondragstart={(e) => {
          dragging = i;
          e.dataTransfer?.setData("text/plain", heading.title);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        }}
        ondragend={endDrag}
        ondragover={(e) => onDragOver(e, dropTarget(e, i))}
        ondrop={onDrop}
      >
        <button
          class="chevron"
          class:open
          class:hidden={!hasChildren[i]}
          tabindex={hasChildren[i] ? 0 : -1}
          aria-expanded={hasChildren[i] ? open : undefined}
          aria-label={heading.title}
          onclick={() => toggle(i)}
        >
          <ChevronRight size={13} />
        </button>
        <button class="heading" title="{heading.file}:{heading.line}" onclick={() => doc.goToSource(heading.file, heading.line)}>
          {#if number}<span class="number">{number}</span>{/if}
          <span class="title">{heading.title}</span>
          {#if printed[i]}<span class="page" title={m.outline_page({ page: printed[i].page })}>{printed[i].page}</span>{/if}
        </button>
      </div>
    {/if}
  {:else}
    <p class="hint">{m.outline_empty()}</p>
  {/each}
  {#if appendix && appendix.index === outline.length && outline.length}{@render appendixLine()}{/if}
</nav>

<!-- Where `\appendix` stands: dropped above it, a part goes to the end of the main part; below it, into the appendix. -->
{#snippet appendixLine()}
  <div
    class="appendix-line"
    class:drop-main={atAppendix(dropAt) && dropPart === "main"}
    class:drop-appendix={atAppendix(dropAt) && dropPart === "appendix"}
    role="separator"
    title={m.outline_appendix_hint()}
    ondragover={(e) => onDragOver(e, lineTarget(e))}
    ondrop={onDrop}
  >
    <span class="rule"></span>
    <span class="label">{m.outline_appendix()}</span>
    <span class="rule"></span>
  </div>
{/snippet}

<style>
  .outline {
    flex: 1;
    overflow: auto;
    padding: var(--space-2) 0;
  }

  .row {
    display: flex;
    align-items: center;
  }

  .row:hover {
    background: var(--hover);
  }

  .row.top {
    font-weight: 600;
  }

  /* While dragging: what moves fades, a line shows where it goes. */
  .row {
    position: relative;
  }

  .row.dragging {
    opacity: 0.5;
  }

  /* Changed a moment ago away from the editor: a band of light runs across the row, as in the file view. */
  .row.changed::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--accent-strong) 24%, transparent) 50%, transparent 70%)
      no-repeat;
    background-size: 300% 100%;
    animation: row-sweep 1100ms cubic-bezier(0.4, 0, 0.2, 1) both;
  }

  @keyframes row-sweep {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: 0 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .row.changed::before {
      animation: none;
    }
  }

  /* The appendix's line: a rule with its name; while dragging, a line above or below it shows the side. */
  .appendix-line {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: var(--space-2) 0;
    padding: var(--space-1) var(--space-4);
    color: var(--text-muted);
    font-size: var(--font-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .appendix-line .rule {
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .appendix-line.drop-main {
    box-shadow: inset 0 2px 0 var(--accent-strong);
  }

  .appendix-line.drop-appendix {
    box-shadow: inset 0 -2px 0 var(--accent-strong);
  }

  .row.drop-before::before,
  .row.drop-after::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent-strong);
    pointer-events: none;
  }

  .row.drop-before::before {
    top: -1px;
  }

  .row.drop-after::after {
    bottom: -1px;
  }

  .chevron {
    display: flex;
    flex-shrink: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-muted);
    transition: transform 0.15s;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .chevron.hidden {
    visibility: hidden;
  }

  .heading {
    display: flex;
    flex: 1;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-1) var(--space-3) var(--space-1) var(--space-2);
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
  }

  .number {
    flex-shrink: 0;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* The page, right-aligned as in a table of contents. */
  .page {
    flex-shrink: 0;
    margin-left: auto;
    padding-left: var(--space-3);
    color: var(--text-muted);
    font-size: var(--font-xs);
    font-variant-numeric: tabular-nums;
  }

  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hint {
    margin: var(--space-5);
    color: var(--text-muted);
    font-size: var(--font-sm);
  }
</style>
