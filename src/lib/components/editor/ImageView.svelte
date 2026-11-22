<script lang="ts">
  import { tick } from "svelte";
  import { api, errorMessage } from "$lib/api";
  import { extensionOf } from "$lib/config/project-files";
  import { MAX_IMAGE_ZOOM, MIN_IMAGE_ZOOM, type ImageZoom } from "$lib/state/image-zoom.svelte";
  import { project } from "$lib/state/project.svelte";
  import { fileName } from "$lib/util/paths";
  import { zoomWheel } from "../window/shortcuts";

  interface Props {
    /** A project file of a `PROJECT_FILES.viewable` type. */
    path: string;
    zoom: ImageZoom;
  }

  let { path, zoom }: Props = $props();

  const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml" };
  /** Space around the image, in pixels; also in the CSS below. */
  const MARGIN = 24;
  /** Zoom change per pixel of pinch, which then follows the fingers exactly (see `zoomWheel`). */
  const PINCH_RATE = 0.01;

  let url = $state<string | null>(null);
  let error = $state<string | null>(null);
  /** The image's own size; an SVG without one has 0 × 0 and is only fitted. */
  let size = $state<{ width: number; height: number } | null>(null);
  let scroller: HTMLDivElement;
  let width = $state(0);
  let height = $state(0);

  const sized = $derived(!!size && size.width > 0 && size.height > 0);

  // Another image starts fitted again.
  $effect(() => {
    void path;
    zoom.min = MIN_IMAGE_ZOOM;
    zoom.max = MAX_IMAGE_ZOOM;
    zoom.reset();
    size = null;
  });

  // Read again when the tree changes, e.g. because the image was replaced outside Gilgamesh.
  $effect(() => {
    const root = project.root;
    const file = path;
    void project.tree;
    if (!root) return;
    let current: string | null = null;
    let cancelled = false;
    api.projectReadBytes(root, file).then(
      (bytes) => {
        if (cancelled) return;
        current = URL.createObjectURL(new Blob([bytes], { type: TYPES[extensionOf(file)] }));
        url = current;
        error = null;
      },
      (err) => {
        if (cancelled) return;
        url = null;
        error = errorMessage(err);
      },
    );
    return () => {
      cancelled = true;
      if (current) URL.revokeObjectURL(current);
    };
  });

  // The factor fitting shows the image at: the pane's room, never beyond its own size.
  $effect(() => {
    if (!size || !sized) return;
    const room = Math.min((width - 2 * MARGIN) / size.width, (height - 2 * MARGIN) / size.height);
    zoom.fit = Math.max(0.01, Math.min(1, room));
  });

  function onLoad(event: Event) {
    const img = event.currentTarget as HTMLImageElement;
    size = { width: img.naturalWidth, height: img.naturalHeight };
  }

  /** Zooms to `next`, keeping the point under the pointer (or the middle) where it is. */
  async function zoomAt(next: number, x = width / 2, y = height / 2) {
    const before = zoom.value;
    const left = scroller.scrollLeft + x;
    const top = scroller.scrollTop + y;
    zoom.set(next);
    await tick();
    const ratio = zoom.value / before;
    scroller.scrollLeft = left * ratio - x;
    scroller.scrollTop = top * ratio - y;
  }

  /** Ctrl + mouse wheel steps, a touchpad pinch follows the fingers; both around the pointer. */
  function onWheel(event: WheelEvent) {
    if (!event.ctrlKey) return;
    // Also without a change, else the webview zooms the whole window.
    event.preventDefault();
    if (!sized) return;
    const { delta, notch } = zoomWheel(event, scroller.clientHeight);
    if (!delta) return;
    const next = notch ? zoom.value * (delta < 0 ? 1.25 : 0.8) : zoom.value * Math.exp(-delta * PINCH_RATE);
    const rect = scroller.getBoundingClientRect();
    void zoomAt(next, event.clientX - rect.left, event.clientY - rect.top);
  }

  /** Ctrl + Plus / Minus once the image was clicked, as in the editor; Ctrl + 0 fits it again. */
  function onKeyDown(event: KeyboardEvent) {
    if (!event.ctrlKey || event.altKey || !sized) return;
    // "+" covers German layouts and the numpad, "=" the unshifted key on US layouts.
    if (event.key === "+" || event.key === "=") void zoomAt(zoom.value * 1.25);
    else if (event.key === "-") void zoomAt(zoom.value * 0.8);
    else if (event.key === "0") zoom.reset();
    else return;
    event.preventDefault();
  }
</script>

<!-- Focusable (tabindex -1) so a click selects the image for the zoom shortcuts. -->
<div class="view" tabindex="-1" role="presentation" onwheel={onWheel} onkeydown={onKeyDown}>
  <div class="scroller" bind:this={scroller} bind:clientWidth={width} bind:clientHeight={height}>
    {#if error}
      <p class="error">{error}</p>
    {:else if url}
      <img
        src={url}
        alt={fileName(path)}
        class:fitted={!sized}
        style:width={sized ? `${size!.width * zoom.value}px` : null}
        style:height={sized ? `${size!.height * zoom.value}px` : null}
        onload={onLoad}
      />
    {/if}
  </div>
  {#if sized}
    <p class="size">{size!.width} × {size!.height} px</p>
  {/if}
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--surface);
    outline: none;
  }

  /* Centred while smaller than the pane (margin: auto), scrolled from the start once larger. */
  .scroller {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  /* A checkerboard shows transparency. */
  img {
    flex-shrink: 0;
    margin: auto;
    border: 24px solid transparent;
    box-sizing: content-box;
    background:
      repeating-conic-gradient(var(--hover) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px,
      var(--surface);
    background-clip: content-box;
    outline: 1px solid var(--border);
    outline-offset: -24px;
  }

  /* No size of its own (an SVG without one): only fitted into the pane. */
  img.fitted {
    width: calc(100% - 48px);
    height: calc(100% - 48px);
    object-fit: contain;
  }

  .size,
  .error {
    margin: 0;
    padding: var(--space-2) var(--space-4);
    color: var(--text-muted);
    font-size: var(--font-sm);
    text-align: center;
  }

  .error {
    margin: auto;
  }
</style>
