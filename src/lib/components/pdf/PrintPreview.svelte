<script lang="ts">
  import { untrack } from "svelte";
  import type { PDFDocumentProxy } from "pdfjs-dist";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { m } from "$lib/paraglide/messages";
  import { CELL_GAP, PAPER_RATIO, SHEET_PADDING, sheetLayout } from "$lib/pdf/sheets";
  import { motionMs } from "$lib/util/motion";
  import Button from "../ui/Button.svelte";

  interface Props {
    pdf: PDFDocumentProxy;
    /** PDF page numbers in print order. */
    pages: number[];
    /** Pages laid side by side on each side of a sheet, as `sheetLayout` arranges them. */
    pagesPerSide: number;
    /**
     * Shown as an open book: the back of one sheet next to the front of the
     * next, turned over like a page.
     */
    twoSided: boolean;
    /**
     * The edge the sheets flip on, as seen on screen: upright, they turn
     * sideways like a book; lying, they turn upwards like a calendar, with the
     * back of one sheet above the front of the next.
     */
    axis: "vertical" | "horizontal";
    grayscale: boolean;
  }

  let { pdf, pages, pagesPerSide, twoSided, axis, grayscale }: Props = $props();

  const TURN_MS = motionMs(700);
  const SLIDE_MS = motionMs(320);

  let area: HTMLDivElement;
  let areaWidth = $state(0);
  let areaHeight = $state(0);
  /** Width / height of the PDF's first page. */
  let pageAspect = $state(210 / 297);

  const layout = $derived(sheetLayout(pagesPerSide, pageAspect));
  /** Width / height of the paper as it lies; pages that do not match it get white margins, as printed. */
  const aspect = $derived(layout.landscape ? 1 / PAPER_RATIO : PAPER_RATIO);
  /** What each side of a sheet carries: the next `pagesPerSide` pages. */
  const sides = $derived.by(() => {
    const result: number[][] = [];
    for (let i = 0; i < pages.length; i += pagesPerSide) result.push(pages.slice(i, i + pagesPerSide));
    return result;
  });

  /** Index into `sides` one-sided; the spread two-sided. */
  let position = $state(0);
  let turning = $state<"forward" | "back" | null>(null);

  // Spread s shows the sides at index 2s-1 (left) and 2s (right): side 1 alone, then 2|3, 4|5, …
  const spreads = $derived(Math.floor(sides.length / 2) + 1);
  const count = $derived(twoSided ? spreads : sides.length);

  /** Room for the sheet captions: below pages side by side, beside pages one above the other. */
  const CAPTION_HEIGHT = 28;
  const CAPTION_WIDTH = 150;

  const size = (width: number) => ({
    width: Math.max(Math.floor(width), 1),
    height: Math.max(Math.floor(width / aspect), 1),
  });
  /** A page on its own: one-sided, and a single page of a book, which looks the same. */
  const soloSize = $derived(size(Math.min(areaWidth, areaHeight * aspect)));
  /** A page of an open book, two to a spread. */
  const pageSize = $derived(
    axis === "vertical"
      ? size(Math.min(areaWidth / 2, (areaHeight - CAPTION_HEIGHT) * aspect))
      : size(Math.min(areaWidth - 2 * CAPTION_WIDTH, (areaHeight / 2) * aspect)),
  );

  $effect(() => {
    const observer = new ResizeObserver(() => {
      areaWidth = area.clientWidth;
      areaHeight = area.clientHeight;
    });
    observer.observe(area);
    return () => observer.disconnect();
  });

  // A new PDF starts at its first page, sized like it.
  $effect(() => {
    const current = pdf;
    untrack(() => (position = 0));
    void current.getPage(1).then((page) => {
      const { width, height } = page.getViewport({ scale: 1 });
      if (current === pdf) pageAspect = width / height;
    });
  });

  /** Index into `pages` of the first page shown, to find it again in another layout. */
  const firstShown = () => {
    const side = twoSided ? (exists(left(position)) ? left(position) : right(position)) : position;
    return side * pagesPerSide;
  };

  // Switching between one- and two-sided, or to more pages per sheet, keeps the shown page in view.
  let anchor = 0;
  let mode = untrack(() => `${twoSided}/${pagesPerSide}`);
  $effect(() => {
    const now = `${twoSided}/${pagesPerSide}`;
    untrack(() => {
      if (now !== mode) {
        const side = Math.floor(anchor / pagesPerSide);
        position = twoSided ? Math.floor((side + 1) / 2) : side;
        mode = now;
      }
    });
  });
  $effect(() => {
    void position;
    anchor = untrack(firstShown);
  });

  $effect(() => {
    if (position > count - 1) position = Math.max(count - 1, 0);
  });

  // ---------------------------------------------------------------- page images

  /** Page images by PDF page number, with the width they were drawn at. */
  let images = $state<Record<number, { url: string; width: number }>>({});
  let generation = 0;
  /** Pages being drawn, as `page@width`. */
  let pending = new Set<string>();

  /** How long the size must hold before the pages are drawn anew for it; until then they are scaled. */
  const SETTLE_MS = 150;

  /** Drawn for the largest size a page is shown at, so a single side of a book stays sharp. */
  const wantedWidth = $derived(Math.ceil(soloSize.width / layout.cols));
  /**
   * The width pages are drawn at: `wantedWidth` once it holds. While the page
   * opens (its panels slide in) or the window is resized, it changes in many
   * small steps; drawing every page for each of them makes the preview jump.
   */
  let renderWidth = $state(0);
  $effect(() => {
    const wanted = wantedWidth;
    // The first size is taken at once: there is nothing to show yet.
    if (untrack(() => renderWidth) <= 1) {
      renderWidth = wanted;
      return;
    }
    const timer = setTimeout(() => (renderWidth = wanted), SETTLE_MS);
    return () => clearTimeout(timer);
  });

  // Another PDF: its pages are other ones.
  $effect(() => {
    void pdf;
    generation++;
    pending = new Set();
    const old = untrack(() => images);
    images = {};
    for (const { url } of Object.values(old)) URL.revokeObjectURL(url);
  });

  /** Draws page `n` at the current width; an image of another width stays shown until then. */
  async function ensure(n: number) {
    const width = renderWidth;
    const key = `${n}@${width}`;
    if (width <= 1 || images[n]?.width === width || pending.has(key)) return;
    const gen = generation;
    pending.add(key);
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (width * (window.devicePixelRatio || 1)) / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, viewport }).promise.catch(() => {});
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
    pending.delete(key);
    if (!blob || gen !== generation || width !== renderWidth) return;
    const old = images[n];
    images = { ...images, [n]: { url: URL.createObjectURL(blob), width } };
    if (old) URL.revokeObjectURL(old.url);
  }

  // The sides shown now and those a turn either way would show, at the current width.
  $effect(() => {
    const p = position;
    void renderWidth;
    const around = twoSided ? [2 * p - 3, 2 * p - 2, 2 * p - 1, 2 * p, 2 * p + 1, 2 * p + 2] : [p - 1, p, p + 1];
    for (const i of around) for (const n of sides[i] ?? []) void ensure(n);
  });

  // ---------------------------------------------------------------- turning

  const left = (s: number) => 2 * s - 1;
  const right = (s: number) => 2 * s;

  /** A turn in progress: sliding the book into place, turning, sliding back. */
  let moving = $state(false);
  /** Holds the book centred on its fold, where both halves are needed. */
  let unfolded = $state(false);

  function next() {
    if (moving || position >= count - 1) return;
    if (!twoSided) return void position++;
    void turn("forward");
  }

  function previous() {
    if (moving || position <= 0) return;
    if (!twoSided) return void position--;
    void turn("back");
  }

  /**
   * Arrow keys turn the way the sheets flip: a book sideways, a calendar up and
   * down. One-sided nothing is flipped, so either pair turns; Page Up/Down always.
   */
  function onkeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // Keys belong to the print settings while one of them has focus, and to an open dialog.
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, select, textarea, [contenteditable]") || document.querySelector("dialog[open]")) return;
    const sideways = !twoSided || axis === "vertical";
    const upright = !twoSided || axis === "horizontal";
    const key = event.key;
    const back = key === "PageUp" || (sideways && key === "ArrowLeft") || (upright && key === "ArrowUp");
    const forward = key === "PageDown" || (sideways && key === "ArrowRight") || (upright && key === "ArrowDown");
    if (!back && !forward) return;
    event.preventDefault();
    if (back) previous();
    else next();
  }

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  /**
   * A single page (the first, perhaps the last) sits in the middle. Turning
   * first slides the book so both halves fit, then turns the leaf, then lets
   * the book settle where the new pages belong.
   */
  async function turn(direction: "forward" | "back") {
    moving = true;
    const slideIn = isShifted(position);
    unfolded = true;
    if (slideIn) await wait(SLIDE_MS);
    turning = direction;
    await wait(TURN_MS);
    position += direction === "forward" ? 1 : -1;
    turning = null;
    // Drawn once at the fold with the new pages, then released to slide.
    await nextFrame();
    unfolded = false;
    if (isShifted(position)) await wait(SLIDE_MS);
    moving = false;
  }

  const isShifted = (s: number) => exists(left(s)) !== exists(right(s));

  /** Moves a spread with only one page so that page is centred, as on a closed book. */
  function shift(s: number) {
    const onlySecond = !exists(left(s)) && exists(right(s));
    const onlyFirst = exists(left(s)) && !exists(right(s));
    const sign = onlySecond ? -1 : onlyFirst ? 1 : 0;
    // Scaled up to the size it has one-sided, around the middle of the spread.
    const scale = sign === 0 ? 1 : soloSize.width / pageSize.width;
    // The captions below a book take room the page on its own does not: centre without it.
    return axis === "vertical"
      ? { x: (sign * scale * pageSize.width) / 2, y: sign === 0 ? 0 : CAPTION_HEIGHT / 2, scale }
      : { x: 0, y: (sign * scale * pageSize.height) / 2, scale };
  }

  const offset = $derived(unfolded ? { x: 0, y: 0, scale: 1 } : shift(position));

  /** What lies under the turning leaf, and what the leaf shows on either side. */
  const shown = $derived.by(() => {
    const p = position;
    if (turning === "forward") {
      return { left: left(p), right: right(p + 1), front: right(p), back: left(p + 1) };
    }
    if (turning === "back") {
      return { left: left(p - 1), right: right(p), front: left(p), back: right(p - 1) };
    }
    return { left: left(p), right: right(p), front: -1, back: -1 };
  });

  const exists = (i: number) => i >= 0 && i < sides.length;
  const sheetLabel = (i: number) => (i % 2 === 0 ? m.print_sheet_front({ sheet: i / 2 + 1 }) : m.print_sheet_back({ sheet: (i + 1) / 2 }));

  /** "Page 3 of 12" or "Pages 5–8 of 12": the pages on the sides in view. */
  const label = $derived.by(() => {
    const shownSides = twoSided ? [left(position), right(position)].filter(exists) : [position];
    if (shownSides.length === 0) return "";
    const from = shownSides[0] * pagesPerSide + 1;
    const to = Math.min((shownSides[shownSides.length - 1] + 1) * pagesPerSide, pages.length);
    return from === to ? m.print_page_of({ page: from, total: pages.length }) : m.print_pages_of({ from, to, total: pages.length });
  });
</script>

<svelte:window {onkeydown} />

{#snippet face(i: number)}
  {#if exists(i)}
    <div
      class="page"
      class:multi={pagesPerSide > 1}
      style:grid-template-columns="repeat({layout.cols}, 1fr)"
      style:grid-template-rows="repeat({layout.rows}, 1fr)"
      style:padding={pagesPerSide > 1 ? SHEET_PADDING : null}
      style:gap={pagesPerSide > 1 ? CELL_GAP : null}
    >
      {#each sides[i] as n (n)}
        <div class="cell">
          {#if images[n]}<img src={images[n].url} alt="" class:grayscale />{/if}
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

<div class="area" bind:this={area}>
  {#if twoSided}
    <!-- "first" is the left page of a book, the upper one of a calendar; "second" the other. -->
    <div
      class="spread {axis}"
      style:--w="{pageSize.width}px"
      style:--h="{pageSize.height}px"
      style:--turn="{TURN_MS}ms"
      style:--slide="{SLIDE_MS}ms"
      style:transform="translate({offset.x}px, {offset.y}px) scale({offset.scale})"
    >
      <div class="slot first">
        {@render face(shown.left)}
        {#if exists(left(position))}<span class="caption" class:hidden={turning || offset.scale !== 1}>{sheetLabel(left(position))}</span
          >{/if}
      </div>
      <div class="slot second">
        {@render face(shown.right)}
        {#if exists(right(position))}<span class="caption" class:hidden={turning || offset.scale !== 1}>{sheetLabel(right(position))}</span
          >{/if}
      </div>
      {#if turning}
        <div class="leaf {turning}">
          <div class="side front">{@render face(shown.front)}</div>
          <div class="side back">{@render face(shown.back)}</div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="single" style:--w="{soloSize.width}px" style:--h="{soloSize.height}px">
      {@render face(position)}
    </div>
  {/if}
</div>

<nav class="pager">
  <Button variant="ghost" title={m.print_prev()} disabled={position === 0 || moving} onclick={previous}>
    <ChevronLeft size={16} />
  </Button>
  <span>{label}</span>
  <Button variant="ghost" title={m.print_next()} disabled={position >= count - 1 || moving} onclick={next}>
    <ChevronRight size={16} />
  </Button>
</nav>

<style>
  .area {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    min-height: 0;
    margin: var(--space-8) var(--space-8) var(--space-4);
    /* Only to look at. A single page of a book is scaled up together with the
       empty half beside it, which would otherwise lie over the controls. */
    pointer-events: none;
  }

  .single,
  .slot {
    position: relative;
    width: var(--w);
    height: var(--h);
  }

  .spread {
    /* The fold shadow fades exponentially (0.12 · e^(−3.7x)): dark at the fold, soon very light. */
    --fold:
      rgb(0 0 0 / 0.12) 0%, rgb(0 0 0 / 0.069) 15%, rgb(0 0 0 / 0.04) 30%, rgb(0 0 0 / 0.019) 50%, rgb(0 0 0 / 0.0075) 75%, transparent 100%;
    position: relative;
    display: flex;
    transition: transform var(--slide) cubic-bezier(0.2, 0, 0, 1);
  }

  .spread.vertical {
    /* Room for the captions under the pages. */
    margin-bottom: 28px;
    perspective: calc(var(--w) * 4);
  }

  .spread.horizontal {
    flex-direction: column;
    perspective: calc(var(--h) * 4);
  }

  .page {
    position: absolute;
    inset: 0;
    display: grid;
    background: var(--paper);
    box-shadow: var(--shadow-page);
  }

  .cell {
    min-width: 0;
    min-height: 0;
  }

  .page img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    transition: filter 200ms ease;
  }

  .page.multi img {
    outline: 1px solid var(--border);
    outline-offset: -1px;
  }

  .page img.grayscale {
    filter: grayscale(1);
  }

  /* The fold where the two pages meet. */
  .slot .page::after {
    content: "";
    position: absolute;
    pointer-events: none;
  }

  .vertical .slot .page::after {
    top: 0;
    bottom: 0;
    width: 6%;
  }

  .horizontal .slot .page::after {
    left: 0;
    right: 0;
    height: 6%;
  }

  .vertical .first .page::after {
    right: 0;
    background: linear-gradient(to left, var(--fold));
  }

  .vertical .second .page::after {
    left: 0;
    background: linear-gradient(to right, var(--fold));
  }

  .horizontal .first .page::after {
    bottom: 0;
    background: linear-gradient(to top, var(--fold));
  }

  .horizontal .second .page::after {
    top: 0;
    background: linear-gradient(to bottom, var(--fold));
  }

  .caption {
    position: absolute;
    font-size: var(--font-sm);
    color: var(--text-muted);
    white-space: nowrap;
    transition: opacity 150ms ease;
  }

  .caption.hidden {
    opacity: 0;
  }

  .vertical .caption {
    top: calc(100% + var(--space-4));
    left: 0;
    right: 0;
    text-align: center;
  }

  .horizontal .caption {
    top: 50%;
    left: calc(100% + var(--space-6));
    transform: translateY(-50%);
  }

  .leaf {
    position: absolute;
    width: var(--w);
    height: var(--h);
    transform-style: preserve-3d;
    animation: var(--turn) cubic-bezier(0.45, 0.05, 0.3, 1) forwards;
  }

  /* Book: the right page turns over to the left, or back. */
  .vertical .leaf.forward {
    top: 0;
    left: var(--w);
    transform-origin: left center;
    animation-name: turn-left;
  }

  .vertical .leaf.back {
    top: 0;
    left: 0;
    transform-origin: right center;
    animation-name: turn-right;
  }

  /* Calendar: the lower page turns up over the top, or back down. */
  .horizontal .leaf.forward {
    top: var(--h);
    left: 0;
    transform-origin: center top;
    animation-name: turn-up;
  }

  .horizontal .leaf.back {
    top: 0;
    left: 0;
    transform-origin: center bottom;
    animation-name: turn-down;
  }

  @keyframes turn-left {
    to {
      transform: rotateY(-180deg);
    }
  }

  @keyframes turn-right {
    to {
      transform: rotateY(180deg);
    }
  }

  @keyframes turn-up {
    to {
      transform: rotateX(180deg);
    }
  }

  @keyframes turn-down {
    to {
      transform: rotateX(-180deg);
    }
  }

  .side {
    position: absolute;
    inset: 0;
    backface-visibility: hidden;
  }

  .vertical .side.back {
    transform: rotateY(180deg);
  }

  .horizontal .side.back {
    transform: rotateX(180deg);
  }

  /* The leaf darkens towards the fold while it stands up, as paper does in light. */
  .side::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0;
    animation: shade var(--turn) ease-in-out forwards;
  }

  .vertical .leaf.forward .side::after {
    background: linear-gradient(to right, rgb(0 0 0 / 0.3), transparent 70%);
  }

  .vertical .leaf.back .side::after {
    background: linear-gradient(to left, rgb(0 0 0 / 0.3), transparent 70%);
  }

  .horizontal .leaf.forward .side::after {
    background: linear-gradient(to bottom, rgb(0 0 0 / 0.3), transparent 70%);
  }

  .horizontal .leaf.back .side::after {
    background: linear-gradient(to top, rgb(0 0 0 / 0.3), transparent 70%);
  }

  @keyframes shade {
    50% {
      opacity: 1;
    }
  }

  .pager {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    padding-bottom: var(--space-6);
    font-size: var(--font-md);
    color: var(--text-muted);
  }
</style>
