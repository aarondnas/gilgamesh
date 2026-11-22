<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import ZoomIn from "@lucide/svelte/icons/zoom-in";
  import ZoomOut from "@lucide/svelte/icons/zoom-out";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import type { LatexEditor } from "$lib/editor/latex-editor";
  import { MAX_EDITOR_ZOOM, MIN_EDITOR_ZOOM, setEditorZoom, sharedEditor, spellLanguage } from "$lib/state/editor.svelte";
  import { project } from "$lib/state/project.svelte";
  import { ImageZoom } from "$lib/state/image-zoom.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import { zoomWheel } from "../window/shortcuts";
  import FileViewer from "./FileViewer.svelte";
  import ImageZoomControls from "./ImageZoomControls.svelte";
  import ProblemsPanel from "./ProblemsPanel.svelte";
  import PaneStrip from "../window/PaneStrip.svelte";
  import Button from "../ui/Button.svelte";
  import ZoomInput from "../ui/ZoomInput.svelte";

  interface Props {
    /** Tab and docking buttons, drawn by `PaneFrame` into this pane's strip. */
    tab: Snippet;
    actions: Snippet;
    /** A file's own editor (a file in a window of its own); the main editor otherwise. */
    editor?: LatexEditor;
  }

  let { tab, actions, editor }: Props = $props();

  /** The main editor is created on first use, so this is only valid after mounting. */
  const target = () => editor ?? doc.editor;

  /** For an image shown in the editor's place (`doc.image`). */
  const imageZoom = new ImageZoom();

  let host: HTMLDivElement;

  // A different language (setting or detected from babel) or file needs a fresh check.
  $effect(() => {
    void (editor ? project.spellLanguage : spellLanguage());
    target()?.refreshSpelling();
  });

  const zoom = $derived(settings.data.editorZoom);

  // Read before the editor check: `doc.editor` is not reactive and still null on
  // the first run, which would otherwise leave this effect without dependencies.
  $effect(() => {
    const value = zoom;
    target()?.setZoom(value);
  });

  /** Pinched so far towards the next 10 % step (see `zoomWheel`). */
  let pinched = 0;
  /** About 10 % of pinch, in the pixels a pinch is reported in. */
  const PINCH_STEP = 10;

  /**
   * Ctrl + mouse wheel zooms, as in browsers and word processors; a touchpad
   * pinch too, in the same 10 % steps once it has gone that far.
   */
  function onWheel(event: WheelEvent) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const { delta, notch } = zoomWheel(event, host.clientHeight);
    if (!delta) return;
    if (!notch) {
      pinched += delta;
      if (Math.abs(pinched) < PINCH_STEP) return;
    }
    const out = notch ? delta > 0 : pinched > 0;
    pinched = 0;
    setEditorZoom(zoom + (out ? -0.1 : 0.1));
  }

  // The editor is not destroyed with the pane: closing, docking and detaching keep its state.
  onMount(() => {
    const shown = editor ?? sharedEditor();
    shown.attach(host);
    if (editor || project.file) shown.focus();
  });
</script>

<div class="pane">
  <PaneStrip {tab} {actions} background="var(--surface)">
    {#if !editor && doc.image}
      <ImageZoomControls zoom={imageZoom} />
    {:else}
      <Button variant="ghost" title={m.editor_zoom_out()} disabled={zoom <= MIN_EDITOR_ZOOM} onclick={() => setEditorZoom(zoom - 0.1)}>
        <ZoomOut size={15} />
      </Button>
      <ZoomInput value={zoom} min={MIN_EDITOR_ZOOM} max={MAX_EDITOR_ZOOM} onchange={(value) => setEditorZoom(value, true)} />
      <Button variant="ghost" title={m.editor_zoom_in()} disabled={zoom >= MAX_EDITOR_ZOOM} onclick={() => setEditorZoom(zoom + 0.1)}>
        <ZoomIn size={15} />
      </Button>
    {/if}
  </PaneStrip>
  <div class="editor" bind:this={host} onwheel={onWheel}></div>
  {#if !editor && doc.image}
    <!-- In the editor's place, which stays mounted with the text files' states. -->
    <div class="image"><FileViewer path={doc.image} zoom={imageZoom} /></div>
  {:else if !editor && !project.file}
    <p class="empty">{m.editor_no_file()}</p>
  {/if}
  {#if !editor}
    <ProblemsPanel />
  {/if}
</div>

<style>
  .pane {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }

  .editor {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .image {
    position: absolute;
    inset: var(--toolbar-height) 0 0;
  }

  .empty {
    position: absolute;
    /* Below the strip, so the tab and its close button stay usable. */
    inset: var(--toolbar-height) 0 0;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: var(--space-7);
    background: var(--surface);
    color: var(--text-muted);
    text-align: center;
  }
</style>
