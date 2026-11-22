<script lang="ts">
  import FileImage from "@lucide/svelte/icons/file-image";
  import FilePenLine from "@lucide/svelte/icons/file-pen-line";
  import SquareArrowDownLeft from "@lucide/svelte/icons/square-arrow-down-left";
  import X from "@lucide/svelte/icons/x";
  import { m } from "$lib/paraglide/messages";
  import { ImageZoom } from "$lib/state/image-zoom.svelte";
  import { project } from "$lib/state/project.svelte";
  import { tabWindows, type FileWindow, type ImageWindow } from "$lib/state/tab-windows.svelte";
  import EditorPane from "../editor/EditorPane.svelte";
  import FileViewer from "../editor/FileViewer.svelte";
  import ImageZoomControls from "../editor/ImageZoomControls.svelte";
  import PaneStrip from "./PaneStrip.svelte";
  import { fileName } from "$lib/util/paths";
  import Button from "../ui/Button.svelte";

  interface Props {
    /** The detached file this window shows: text in its own editor, or an image. */
    window: FileWindow | ImageWindow;
  }

  let { window }: Props = $props();

  let frame: HTMLDivElement;

  // Renamed files keep their window; the lists are replaced on rename, which re-runs this.
  const path = $derived((tabWindows.list, tabWindows.images, "buffer" in window ? window.buffer.path : window.path));
  const zoom = new ImageZoom();
  const name = $derived(fileName(path));

  $effect(() => {
    frame.ownerDocument.title = [name, project.name, "Gilgamesh"].filter(Boolean).join(" – ");
  });
</script>

{#snippet tab()}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tab" title={path} ondblclick={() => tabWindows.dock(window.key)}>
    {#if "buffer" in window}<FilePenLine size={14} />{:else}<FileImage size={14} />{/if}
    <span class="label">{name}</span>
    <button class="close" title={m.pane_close()} aria-label={m.pane_close()} onclick={() => tabWindows.close(window.key)}>
      <X size={13} />
    </button>
  </div>
{/snippet}

{#snippet actions()}
  <Button variant="ghost" title={m.pane_dock_title()} aria-label={m.pane_dock_title()} onclick={() => tabWindows.dock(window.key)}>
    <SquareArrowDownLeft size={14} />
  </Button>
{/snippet}

<div class="frame" bind:this={frame}>
  {#if "buffer" in window}
    <EditorPane {tab} {actions} editor={window.editor} />
  {:else}
    <PaneStrip {tab} {actions} background="var(--surface)">
      <ImageZoomControls {zoom} />
    </PaneStrip>
    <div class="image"><FileViewer {path} {zoom} /></div>
  {/if}
</div>

<style>
  .frame {
    display: flex;
    flex-direction: column;
    height: 100vh;
    min-width: 0;
  }

  .image {
    flex: 1;
    min-height: 0;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    max-width: 60%;
    height: calc(100% - var(--space-2));
    margin-bottom: -1px;
    padding: 0 var(--space-2) 0 var(--space-4);
    border: 1px solid var(--border);
    border-bottom-color: var(--tab-bg);
    border-top: 2px solid var(--accent-strong);
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    background: var(--tab-bg);
    color: var(--text);
    font-size: var(--font-sm);
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
  }

  .close:hover {
    background: var(--pressed);
    color: var(--text);
  }
</style>
