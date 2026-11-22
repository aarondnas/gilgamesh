<script lang="ts">
  import { onMount } from "svelte";
  import { api, errorMessage } from "$lib/api";
  import { extensionOf } from "$lib/config/project-files";
  import { m } from "$lib/paraglide/messages";
  import { MAX_PDF_ZOOM, MIN_PDF_ZOOM, PdfRenderer } from "$lib/pdf/renderer";
  import type { ImageZoom } from "$lib/state/image-zoom.svelte";
  import { project } from "$lib/state/project.svelte";
  import { zoomWheel } from "../window/shortcuts";

  interface Props {
    /** A PDF of the project, or an EPS figure, shown converted to PDF. */
    path: string;
    /** 1 (100 %) is a whole page fitting the pane, as in the preview. */
    zoom: ImageZoom;
  }

  let { path, zoom }: Props = $props();

  /** Zoom change per pixel of pinch, which then follows the fingers exactly (see `zoomWheel`). */
  const PINCH_RATE = 0.01;

  let viewport: HTMLDivElement;
  let renderer = $state<PdfRenderer | null>(null);
  let error = $state<string | null>(null);
  /** An EPS figure is being converted (the first time perhaps after installing `epstopdf`). */
  let converting = $state(false);

  // Another file starts fitted again; the renderer's zoom counts from fitting.
  $effect(() => {
    void path;
    zoom.min = MIN_PDF_ZOOM;
    zoom.max = MAX_PDF_ZOOM;
    zoom.fit = 1;
    zoom.reset();
  });

  onMount(() => {
    const r = new PdfRenderer(viewport);
    renderer = r;
    // The observer must come from the window that shows the view, which may be a detached one.
    const Observer = viewport.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new Observer(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void r.resize(), 150);
    });
    observer.observe(viewport);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      r.destroy();
      renderer = null;
    };
  });

  // Read (and converted) again when the tree changes, e.g. because the file was replaced outside Gilgamesh.
  $effect(() => {
    const r = renderer;
    const root = project.root;
    const file = path;
    void project.tree;
    if (!r || !root) return;
    let cancelled = false;
    const eps = extensionOf(file) === "eps";
    converting = eps;
    (eps ? api.epsToPdf(root, file) : api.projectReadBytes(root, file))
      .then((bytes) => {
        if (cancelled) return;
        error = null;
        return r.load(bytes);
      })
      .catch((err) => {
        if (!cancelled) error = errorMessage(err);
      })
      .finally(() => {
        if (!cancelled) converting = false;
      });
    return () => {
      cancelled = true;
    };
  });

  // The buttons and typed values; wheel and pinch have zoomed the renderer already.
  $effect(() => {
    const value = zoom.value;
    if (renderer && renderer.zoom !== value) void renderer.setZoom(value);
  });

  /** Ctrl + mouse wheel steps, a touchpad pinch follows the fingers; both around the pointer. */
  function onWheel(event: WheelEvent) {
    if (!event.ctrlKey || !renderer) return;
    // Also without a change, else the webview zooms the whole window.
    event.preventDefault();
    const { delta, notch } = zoomWheel(event, viewport.clientHeight);
    if (!delta) return;
    zoom.set(notch ? zoom.value * (delta < 0 ? 1.25 : 0.8) : zoom.value * Math.exp(-delta * PINCH_RATE));
    renderer.zoomAround(zoom.value, event.clientX, event.clientY);
  }

  /** Ctrl + Plus / Minus once the page was clicked, as in the editor; Ctrl + 0 fits it again. */
  function onKeyDown(event: KeyboardEvent) {
    if (!event.ctrlKey || event.altKey) return;
    // "+" covers German layouts and the numpad, "=" the unshifted key on US layouts.
    if (event.key === "+" || event.key === "=") zoom.step(false);
    else if (event.key === "-") zoom.step(true);
    else if (event.key === "0") zoom.reset();
    else return;
    event.preventDefault();
  }
</script>

<!-- Focusable (tabindex -1) so a click selects the pages for the zoom shortcuts. -->
<div class="view">
  <div
    class="viewport"
    class:hidden={!!error}
    bind:this={viewport}
    tabindex="-1"
    role="presentation"
    onwheel={onWheel}
    onkeydown={onKeyDown}
  ></div>
  {#if error}
    <p class="note">{error}</p>
  {:else if converting}
    <p class="note">{m.viewer_converting()}</p>
  {/if}
</div>

<style>
  .view {
    position: relative;
    height: 100%;
    background: var(--canvas);
  }

  .viewport {
    height: 100%;
    overflow: auto;
    padding: var(--space-6);
    box-sizing: border-box;
    /* The renderer keeps the scroll position itself when it swaps the pages. */
    overflow-anchor: none;
    outline: none;
  }

  .viewport.hidden {
    visibility: hidden;
  }

  .viewport :global(.pdf-page) {
    background: var(--paper);
    box-shadow: var(--shadow-page);
  }

  .note {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: var(--space-7);
    color: var(--text-muted);
    font-size: var(--font-sm);
    text-align: center;
    white-space: pre-line;
  }
</style>
