<script lang="ts" module>
  /** Kept while the pane is closed, docked or detached, which mounts it anew. */
  let lastZoom = 1;
</script>

<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import ZoomIn from "@lucide/svelte/icons/zoom-in";
  import ZoomOut from "@lucide/svelte/icons/zoom-out";
  import FileText from "@lucide/svelte/icons/file-text";
  import Scan from "@lucide/svelte/icons/scan";
  import { MAX_PDF_ZOOM, MIN_PDF_ZOOM, PdfRenderer } from "$lib/pdf/renderer";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { build } from "$lib/state/build.svelte";
  import { packages } from "$lib/state/packages.svelte";
  import { panes } from "$lib/state/panes.svelte";
  import { project } from "$lib/state/project.svelte";
  import { zoomWheel } from "../window/shortcuts";
  import PaneStrip, { type StripGrip } from "../window/PaneStrip.svelte";
  import Button from "../ui/Button.svelte";
  import ZoomInput from "../ui/ZoomInput.svelte";

  interface Props {
    /** Title and docking buttons, drawn by `PaneFrame` into this pane's strip. */
    tab: Snippet;
    actions: Snippet;
    /** Makes the strip the handle for detaching the preview. */
    grip?: StripGrip;
  }

  let { tab, actions, grip }: Props = $props();

  /** Zoom change per pixel of pinch, which follows the fingers exactly (see `zoomWheel`). */
  const PINCH_RATE = 0.01;

  let viewport: HTMLDivElement;
  let renderer: PdfRenderer | null = $state(null);
  let zoom = $state(lastZoom);

  $effect(() => {
    lastZoom = zoom;
  });

  /**
   * While the pane glides to the fitting width, the pages stretch with it instead of
   * being drawn anew every frame; they stay stretched until the sharp render after it.
   */
  let fluid = $state(false);
  $effect(() => {
    if (panes.animatingSplit) fluid = true;
  });

  /** Back to 100 % in a pane exactly as wide as a whole page needs. */
  function fitPage() {
    setZoom(1);
    panes.fitPage();
  }

  onMount(() => {
    const r = new PdfRenderer(viewport);
    void r.setZoom(zoom);
    renderer = r;
    let resizeTimer: ReturnType<typeof setTimeout>;
    // The observer must come from the window that shows the pane, which may be a detached one.
    const Observer = viewport.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
    // Only once the size has settled (the ribbon folding, the window being dragged larger):
    // the width a whole page needs follows the height, and taking it over in every step of
    // a change would move the divider and lay out editor and preview anew each time.
    const observer = new Observer(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        reportFitWidth();
        void r.resize().then(() => {
          if (!panes.animatingSplit) fluid = false;
        });
      }, 150);
    });
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      r.destroy();
      renderer = null;
    };
  });

  $effect(() => {
    // pdf.js takes ownership of the buffer, so hand it a copy.
    if (renderer && build.pdf) void renderer.load(build.pdf.slice(0), fitBeforeDrawing);
  });

  /**
   * A new document may need another width (another page shape): the pane takes
   * it first and the pages are drawn once, at their final size, instead of
   * drawn, resized and drawn again.
   */
  async function fitBeforeDrawing() {
    const before = panes.pdfFitWidth;
    reportFitWidth();
    if (panes.pdfFitWidth === before) return;
    // Two frames: the new width is laid out in the first, measurable in the second.
    const frame = viewport.ownerDocument.defaultView?.requestAnimationFrame ?? requestAnimationFrame;
    for (let i = 0; i < 2; i++) await new Promise((resolve) => frame(resolve));
  }

  /**
   * At 100 % a whole page fits the viewport; it fills the width exactly when the
   * viewport is its height × the page's aspect ratio wide. Depends on the height
   * only, so the main window can size the pane by it without a feedback loop.
   */
  function reportFitWidth() {
    // Only the docked pane shapes the main window; hidden (settings open) it has no height.
    if (!renderer || panes.mode.pdf !== "docked" || viewport.clientHeight === 0) return;
    const scrollbar = viewport.offsetWidth - viewport.clientWidth;
    panes.pdfFitWidth = Math.floor(viewport.clientHeight * renderer.pageAspect) + scrollbar;
  }

  $effect(() => {
    if (renderer && doc.pdfTarget) renderer.reveal(doc.pdfTarget);
  });

  /** Only these leave the app, in the browser or the mail program: a PDF may hold any address. */
  const OPENABLE = /^(https?|mailto|ftp):/i;

  /** Follows a link as a PDF viewer does: a web address in the browser, a reference to its place. */
  function onClick(event: MouseEvent) {
    // The second click of a double click is the jump to the source, not another opening.
    const link = event.detail === 1 ? renderer?.linkAt(event.clientX, event.clientY) : null;
    if (!link) return;
    if ("url" in link) {
      if (OPENABLE.test(link.url)) void openUrl(link.url);
    } else void renderer?.goTo(link.dest);
  }

  /** The hand over a link, and its address as tooltip. */
  let hoveredLink = $state<string | null>(null);
  function onPointerMove(event: PointerEvent) {
    const link = renderer?.linkAt(event.clientX, event.clientY);
    hoveredLink = link ? ("url" in link ? link.url : "") : null;
  }

  function onDoubleClick(event: MouseEvent) {
    const at = renderer?.locate(event.clientX, event.clientY);
    if (at) void doc.syncFromPdf(at);
  }

  /** `exact` keeps a typed value such as 125 %; steps are rounded so they land on 90 %, 100 %, … */
  function setZoom(value: number, exact = false) {
    if (!renderer) return;
    void renderer.setZoom(exact ? Math.round(value * 100) / 100 : Math.round(value * 10) / 10);
    // Taken right away, not after rendering: quick wheel steps build on each other.
    zoom = renderer.zoom;
  }

  /**
   * Ctrl + mouse wheel and pinching on the touchpad (which the webview reports
   * as Ctrl + wheel) zoom around the pointer. A wheel notch steps by 10 %, to
   * 90 %, 100 %, …; a pinch follows the fingers smoothly.
   */
  function onWheel(event: WheelEvent) {
    if (!event.ctrlKey || !renderer) return;
    // Also without a change, else the webview zooms the whole window.
    event.preventDefault();
    const { delta, notch } = zoomWheel(event, viewport.clientHeight);
    if (!delta) return;
    const next = notch ? Math.round((zoom + (delta < 0 ? 0.1 : -0.1)) * 10) / 10 : zoom * Math.exp(-delta * PINCH_RATE);
    renderer.zoomAround(next, event.clientX, event.clientY);
    zoom = renderer.zoom;
  }

  /** Ctrl + Plus / Minus / 0 once the preview was clicked, as in the editor. */
  function onKeyDown(event: KeyboardEvent) {
    if (!event.ctrlKey || event.altKey) return;
    // "+" covers German layouts and the numpad, "=" the unshifted key on US layouts.
    const step = { "+": 0.1, "=": 0.1, "-": -0.1 }[event.key];
    if (step !== undefined) setZoom(zoom + step);
    else if (event.key === "0") setZoom(1);
    else return;
    event.preventDefault();
  }
</script>

<div class="pane">
  <!-- While a build runs, a bar runs along the strip; the preview below stays as it is, to read and scroll. -->
  <PaneStrip {tab} {actions} {grip} background="var(--canvas)" busy={build.building} label={m.pdf_compiling()}>
    <Button variant="ghost" title={m.pdf_zoom_out()} onclick={() => setZoom(zoom - 0.1)}><ZoomOut size={15} /></Button>
    <ZoomInput value={zoom} min={MIN_PDF_ZOOM} max={MAX_PDF_ZOOM} onchange={(value) => setZoom(value, true)} />
    <Button variant="ghost" title={m.pdf_zoom_in()} onclick={() => setZoom(zoom + 0.1)}><ZoomIn size={15} /></Button>
    <Button variant="ghost" title={m.pdf_fit_page()} onclick={fitPage}><Scan size={15} /></Button>
  </PaneStrip>

  <!-- Focusable (tabindex -1) so a click selects the preview for the zoom shortcuts. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="viewport"
    class:fluid
    bind:this={viewport}
    tabindex="-1"
    class:on-link={hoveredLink !== null}
    onclick={onClick}
    onpointermove={onPointerMove}
    onpointerleave={() => (hoveredLink = null)}
    ondblclick={onDoubleClick}
    onwheel={onWheel}
    onkeydown={onKeyDown}
    title={hoveredLink || (build.pdf ? m.pdf_sync_hint() : undefined)}
  ></div>

  {#if !build.pdf}
    <div class="empty">
      <FileText size={40} strokeWidth={1.2} />
      {#if !packages.installed}
        <p>{m.pdf_latex_missing()}</p>
        <Button variant="link" onclick={() => doc.openSettings("packages")}>{m.pdf_install_link()}</Button>
      {:else if !project.config.main}
        <p>{m.pdf_no_main()}</p>
      {:else if build.building}
        <p>{m.pdf_compiling()}</p>
      {:else}
        <p>{m.pdf_no_preview()}<br />{m.pdf_compile_hint()} <kbd>{m.key_ctrl()}</kbd>+<kbd>Enter</kbd></p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .pane {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    background: var(--canvas);
  }

  .viewport {
    flex: 1;
    overflow: auto;
    /* No padding at the top and sides: at 100 % the first page fills the pane edge to edge. */
    padding: 0 0 var(--space-6);
    /* The renderer keeps the scroll position itself when it swaps the pages; the browser's own anchoring would move it again. */
    overflow-anchor: none;
  }

  .viewport:focus {
    outline: none;
  }

  .viewport.on-link {
    cursor: pointer;
  }

  .viewport :global(.sync-highlight) {
    position: absolute;
    border-radius: var(--radius-sm);
    background: rgb(255 214 0 / 0.35);
    outline: 2px solid rgb(255 180 0 / 0.8);
    pointer-events: none;
    animation: sync-fade 1.5s ease-out forwards;
  }

  @keyframes sync-fade {
    0%,
    60% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  .viewport :global(.pdf-page) {
    background: var(--paper);
    box-shadow: var(--shadow-page);
  }

  /* While the docked pane glides to its fitting width, where a page is as wide as the viewport. */
  .viewport.fluid :global(.pdf-page) {
    width: 100% !important;
    height: auto !important;
  }

  .empty {
    position: absolute;
    inset: var(--toolbar-height) 0 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    color: var(--text-muted);
    text-align: center;
  }

  .empty p {
    margin: 0;
    line-height: 1.6;
  }
</style>
