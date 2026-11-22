<script lang="ts" module>
  import type { ListContext, ListEntry } from "$lib/latex/lists";

  /** What the list dialogs read: places, suggestion, and the main file's text they belong to; editing a list, `entry` is that list. */
  export type ListDialogContext = ListContext & { source: string; entry?: ListEntry };
</script>

<script lang="ts">
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import GripVertical from "@lucide/svelte/icons/grip-vertical";
  import type { ProjectScan } from "$lib/api";
  import type { ListKind } from "$lib/latex/lists";
  import { m } from "$lib/paraglide/messages";
  import { project } from "$lib/state/project.svelte";
  import { listNames } from "./list-names";

  interface Props {
    /** `null` while it is read: the outline then stays empty, dimmed. */
    context: ListDialogContext | null;
    /** The chosen place, an offset in the main file. */
    at: number;
    /** What the list to place is called, on the block that is moved. */
    label: string;
    /** Beside the label where the list is at the suggested place, e.g. "Suggestion". */
    tag: string;
    busy: boolean;
  }

  let { context, at = $bindable(), label, tag, busy }: Props = $props();

  type Heading = ProjectScan["outline"][number];
  /** A part of the document at the top level: a main heading with those below it, or a list already there. */
  interface Unit {
    /** The main file's line that holds it or reads in the file holding it. */
    line: number;
    heading: Heading | null;
    children: Heading[];
    kind: ListKind | null;
  }

  /** Lines above a part that belong to it, so a list goes above them: comments, the appendix switch, page numbering, its contents entry. */
  const LEAD_IN =
    /^\s*($|%|\\(?:(?:appendix|frontmatter|mainmatter|backmatter|pagenumbering|pagestyle|thispagestyle|phantomsection|addcontentsline)\b|setcounter\s*\{page\}))/;

  /**
   * The document as the explorer's outline shows it, with the lists already
   * there, and the places between its main parts (`slots[u]` lies before part
   * `u`, the last one behind all): where the main file reads in two parts in
   * one line there is no place between them. The suggested place keeps the
   * exact spot the suggestion found.
   */
  const view = $derived.by(() => {
    const units: Unit[] = [];
    const slots: (number | null)[] = [];
    const main = project.config.main;
    const scan = project.scan;
    if (!context || !main) return { units, slots };
    const { positions, suggested, source } = context;

    const mainLine = (file: string, line: number): number | null => {
      let at = { file, line };
      for (let depth = 0; at.file !== main; depth++) {
        const inc = scan?.inclusions.find((i) => i.file === at.file);
        if (!inc || depth > 20) return null;
        at = { file: inc.parent, line: inc.line };
      }
      return at.line;
    };
    const outline = scan?.outline ?? [];
    const top = Math.min(...outline.map((h) => h.level));
    const lists: Unit[] = context.lists.map((list) => ({ line: list.line, heading: null, children: [], kind: list.kind }));
    const edited = context.entry?.line;
    for (const h of outline) {
      if (h.level !== top) {
        units.at(-1)?.children.push(h);
        continue;
      }
      const line = mainLine(h.file, h.line);
      // A list's own heading (in the file that prints it) shows as the list.
      if (line !== null && !lists.some((l) => l.line === line)) units.push({ line, heading: h, children: [], kind: null });
    }
    // The list being edited is the one to move, at its own place (the suggestion).
    units.push(...lists.filter((l) => l.line !== edited));
    units.sort((a, b) => a.line - b.line);

    const lines = source.split("\n");
    const starts: number[] = [];
    let offset = 0;
    for (const l of lines) {
      starts.push(offset);
      offset += l.length + 1;
    }
    const bodyStart = positions[0]?.at ?? 0;
    const end = positions.at(-1)?.at ?? source.length;
    for (let u = 0; u <= units.length; u++) {
      if (u === units.length) {
        slots.push(end);
        continue;
      }
      if (u > 0 && units[u - 1].line === units[u].line) {
        slots.push(null);
        continue;
      }
      let n = units[u].line;
      const floor = u > 0 ? units[u - 1].line : 0;
      while (n - 1 > floor && starts[n - 2] >= bodyStart && LEAD_IN.test(lines[n - 2])) n--;
      slots.push(Math.max(starts[n - 1], bodyStart));
    }
    // The suggestion: the place before the first part it lies above, with its own spot.
    const first = units.findIndex((unit) => starts[unit.line - 1] >= suggested);
    const s = first < 0 ? units.length : first;
    if (slots[s] !== null) slots[s] = suggested;
    return { units, slots };
  });

  const places = $derived(view.slots.filter((s): s is number => s !== null));

  // Where the suggestion falls between two parts read in on one line, the nearest place there is.
  $effect(() => {
    if (!places.length || places.includes(at)) return;
    at = places.reduce((best, p) => (Math.abs(p - at) < Math.abs(best - at) ? p : best));
  });

  /** Moves the list to the place `by` places further down (negative: up). */
  function step(by: number) {
    const next = places[places.indexOf(at) + by];
    if (next !== undefined) at = next;
  }

  let draggingNew = $state(false);
  let dropSlot = $state<number | null>(null);
  let structureEl = $state<HTMLElement | null>(null);

  /** Within this distance of the view's upper or lower edge (and beyond it), dragging scrolls. */
  const SCROLL_EDGE = 48;
  /** Pixels per frame at the very edge; slower further in. */
  const SCROLL_MAX = 16;
  let scrollSpeed = 0;
  let scrollFrame = 0;
  let pointerY = 0;

  /** The place nearest to `y` (window coordinates): the gaps and the moved list carry theirs in `data-slot`. */
  function nearestSlot(y: number): number | null {
    let best: { slot: number; distance: number } | null = null;
    for (const el of structureEl?.querySelectorAll<HTMLElement>("[data-slot]") ?? []) {
      const rect = el.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - y);
      if (!best || distance < best.distance) best = { slot: Number(el.dataset.slot), distance };
    }
    return best?.slot ?? null;
  }

  /**
   * While the list is dragged, anywhere over the window: near the view's
   * edges it scrolls, the faster the closer the pointer (also past the edge);
   * the place nearest the pointer is marked.
   */
  function onWindowDragOver(event: DragEvent) {
    if (!draggingNew || !structureEl) return;
    // Let go anywhere, also past the view's edge after scrolling: it goes to the marked place.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    pointerY = event.clientY;
    const rect = structureEl.getBoundingClientRect();
    const fromTop = event.clientY - rect.top;
    const fromBottom = rect.bottom - event.clientY;
    const pace = (distance: number) => Math.ceil(((SCROLL_EDGE - Math.max(distance, 0)) / SCROLL_EDGE) ** 2 * SCROLL_MAX);
    scrollSpeed = fromTop < SCROLL_EDGE ? -pace(fromTop) : fromBottom < SCROLL_EDGE ? pace(fromBottom) : 0;
    if (scrollSpeed && !scrollFrame) scrollFrame = requestAnimationFrame(scroll);
    dropSlot = nearestSlot(Math.min(Math.max(pointerY, rect.top), rect.bottom));
  }

  function scroll() {
    scrollFrame = 0;
    if (!draggingNew || !scrollSpeed || !structureEl) return;
    structureEl.scrollTop += scrollSpeed;
    // What lies under the pointer moved.
    const rect = structureEl.getBoundingClientRect();
    dropSlot = nearestSlot(Math.min(Math.max(pointerY, rect.top), rect.bottom));
    scrollFrame = requestAnimationFrame(scroll);
  }

  function endDrag() {
    draggingNew = false;
    dropSlot = null;
    scrollSpeed = 0;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  }

  function onWindowDrop(event: DragEvent) {
    if (!draggingNew) return;
    event.preventDefault();
    if (dropSlot !== null) at = dropSlot;
    endDrag();
  }
</script>

<svelte:window ondragover={onWindowDragOver} ondrop={onWindowDrop} />

<div class="field">
  <span>{m.lists_position()}</span>
  <!-- The outline as in the explorer; the list goes between its main parts: dragged, moved with the arrows, or put where a gap is clicked. -->
  <div class="structure" class:loading={!context} role="listbox" aria-label={m.lists_position()} tabindex="-1" bind:this={structureEl}>
    {#each view.units as unit, u (u)}
      {@render place(view.slots[u])}
      {#if unit.kind}
        {@const Icon = listNames[unit.kind].icon}
        <div class="row list" title={m.lists_line({ number: unit.line })}>
          <Icon size={13} />
          <span class="title">{listNames[unit.kind].name()}</span>
        </div>
      {:else if unit.heading}
        <div class="row top" title="{unit.heading.file}:{unit.heading.line}">
          {#if unit.heading.number}<span class="number">{unit.heading.number}</span>{/if}
          <span class="title">{unit.heading.title}</span>
        </div>
        {#each unit.children as child, c (c)}
          <div class="row child" style:padding-left="{(child.level - unit.heading.level) * 12 + 8}px">
            {#if child.number}<span class="number">{child.number}</span>{/if}
            <span class="title">{child.title}</span>
          </div>
        {/each}
      {/if}
    {/each}
    {@render place(view.slots[view.units.length])}
  </div>
</div>

<!-- A place between two main parts: the list where it is chosen, else a gap to put it in. -->
{#snippet place(slot: number | null)}
  {#if slot === null}
    <!-- Two parts read in on one line: nothing can go between them. -->
  {:else if slot === at}
    <div
      class="new"
      class:dragging={draggingNew}
      class:target={draggingNew && dropSlot === slot}
      data-slot={slot}
      role="option"
      aria-selected="true"
      tabindex="0"
      draggable={!busy}
      title={m.lists_structure_hint()}
      ondragstart={(e) => {
        draggingNew = true;
        e.dataTransfer?.setData("text/plain", label);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      }}
      ondragend={endDrag}
      onkeydown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        step(e.key === "ArrowUp" ? -1 : 1);
      }}
    >
      <GripVertical size={14} />
      <span class="new-title">{label}</span>
      {#if at === context?.suggested}<span class="tag">{tag}</span>{/if}
      <button type="button" title={m.lists_move_up()} disabled={busy || places.indexOf(at) === 0} onclick={() => step(-1)}>
        <ArrowUp size={14} />
      </button>
      <button type="button" title={m.lists_move_down()} disabled={busy || places.indexOf(at) === places.length - 1} onclick={() => step(1)}>
        <ArrowDown size={14} />
      </button>
    </div>
  {:else}
    <button
      type="button"
      class="gap"
      class:target={dropSlot === slot}
      data-slot={slot}
      title={m.lists_place_here()}
      aria-label={m.lists_place_here()}
      disabled={busy}
      onclick={() => (at = slot)}
    ></button>
  {/if}
{/snippet}

<style>
  /* The document's structure; the list to place stands out and can be moved. */
  .structure {
    display: flex;
    flex-direction: column;
    max-height: 260px;
    min-height: 80px;
    overflow: auto;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    font-weight: normal;
  }

  .structure.loading {
    opacity: 0.5;
  }

  /* Rows as in the explorer's outline: number, title; main parts bold. */
  .row {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-sm);
  }

  .row.top {
    font-weight: 600;
  }

  .row.list {
    color: var(--text-muted);
    font-style: italic;
  }

  .row.list :global(svg) {
    flex-shrink: 0;
  }

  .number {
    flex-shrink: 0;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* A place between two parts: thin; a line shows on hover or while the list is dragged over it. */
  .gap {
    position: relative;
    flex-shrink: 0;
    height: 8px;
    margin: -2px 0;
    padding: 0;
    border: none;
    background: none;
  }

  .gap:hover:not(:disabled)::after,
  .gap.target::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 0;
    right: 0;
    height: 2px;
    border-radius: 1px;
    background: var(--accent-strong);
  }

  .new {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-1) 0;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--accent-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-size: var(--font-sm);
    font-weight: 600;
  }

  .new:focus-visible {
    outline: 2px solid var(--accent-strong);
    outline-offset: 1px;
  }

  .new.dragging {
    opacity: 0.5;
  }

  .new-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag {
    color: var(--text-muted);
    font-size: var(--font-xs);
    font-weight: normal;
  }

  .new button {
    display: flex;
    padding: 2px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
  }

  .new button:hover:not(:disabled) {
    background: var(--hover);
  }

  .new button:disabled {
    opacity: 0.35;
  }
</style>
