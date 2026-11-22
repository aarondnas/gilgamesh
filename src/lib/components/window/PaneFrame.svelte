<script lang="ts">
  import FilePenLine from "@lucide/svelte/icons/file-pen-line";
  import FileImage from "@lucide/svelte/icons/file-image";
  import FileText from "@lucide/svelte/icons/file-text";
  import SquareArrowDownLeft from "@lucide/svelte/icons/square-arrow-down-left";
  import SquareArrowOutUpRight from "@lucide/svelte/icons/square-arrow-out-up-right";
  import X from "@lucide/svelte/icons/x";
  import { m } from "$lib/paraglide/messages";
  import { fileKind } from "$lib/config/project-files";
  import { doc } from "$lib/state/document.svelte";
  import { panes, type PaneId } from "$lib/state/panes.svelte";
  import { tabWindows } from "$lib/state/tab-windows.svelte";
  import { project } from "$lib/state/project.svelte";
  import EditorPane from "../editor/EditorPane.svelte";
  import PdfPane from "../pdf/PdfPane.svelte";
  import type { StripGrip } from "./PaneStrip.svelte";
  import { fileName } from "$lib/util/paths";
  import Button from "../ui/Button.svelte";

  interface Props {
    id: PaneId;
    /** Shown in a window of its own instead of the main window. */
    detached?: boolean;
  }

  let { id, detached = false }: Props = $props();

  let frame: HTMLDivElement;

  const Icon = $derived(id === "editor" ? FilePenLine : FileText);
  const label = $derived(id === "editor" ? (doc.shown ? fileName(doc.shown) : m.pane_editor()) : m.pane_pdf());
  const hint = $derived(id === "editor" ? (doc.shown ?? m.pane_editor()) : m.pane_pdf());
  /** The editor shows one tab per open file; the preview, and an empty editor, a single tab. */
  const fileTabs = $derived(id === "editor" ? doc.tabs : []);

  // The window title of a detached pane, also shown in the taskbar.
  $effect(() => {
    if (detached) frame.ownerDocument.title = [label, project.name, "Gilgamesh"].filter(Boolean).join(" – ");
  });

  function toggleDetached() {
    if (detached) panes.dock(id);
    else void panes.detach(id);
  }

  /** Roughly the native title bar plus half the tab strip, so the new window's tab lands under the pointer. */
  const WINDOW_CHROME = { x: 8, y: 46 };
  /** Marks a drag as a pane tab, so drop targets such as the explorer ignore it. */
  const PANE_DRAG_TYPE = "application/x-gilgamesh-pane";

  let dragging = $state(false);
  /** Where on the tab it was grabbed, so the new window opens with the tab under the pointer. */
  let grab = 0;
  /** Whether the drag last left the window (and did not come back). */
  let leftWindow = false;

  /**
   * Native drag and drop, because it still reports where the tab was released
   * when that is outside the window; pointer events stop at the window's edge.
   */
  /**
   * `file`: a file's tab, which goes into a window of its own (also out of a
   * detached editor); without, the whole pane is detached.
   */
  function onDragStart(event: DragEvent, file?: string) {
    if (!event.dataTransfer || (detached && !file)) return;
    const tab = event.currentTarget as HTMLElement;
    grab = event.clientX - tab.getBoundingClientRect().left;
    leftWindow = false;
    dragging = true;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(PANE_DRAG_TYPE, id);
    const win = tab.ownerDocument.defaultView ?? window;
    const enter = () => (leftWindow = false);
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) leftWindow = true;
    };
    const end = (e: DragEvent) => {
      win.removeEventListener("dragenter", enter);
      win.removeEventListener("dragleave", leave);
      win.removeEventListener("dragend", end, true);
      dragging = false;
      const outside = e.clientX < 0 || e.clientY < 0 || e.clientX >= win.innerWidth || e.clientY >= win.innerHeight;
      // Dropped on something in the window that accepted it: not a detach.
      if (!(leftWindow || outside) || e.dataTransfer?.dropEffect !== "none") return;
      const known = e.screenX !== 0 || e.screenY !== 0;
      const at = known ? { x: e.screenX - grab - WINDOW_CHROME.x, y: e.screenY - WINDOW_CHROME.y } : undefined;
      if (file) void tabWindows.detach(file, at);
      else void panes.detach(id, at);
    };
    win.addEventListener("dragenter", enter);
    win.addEventListener("dragleave", leave);
    win.addEventListener("dragend", end, true);
  }

  /** Buttons and fields in a strip that is a handle: they keep working, nothing is dragged from them. */
  const onControl = (event: Event) => event.target instanceof Element && !!event.target.closest("button, input, select, a");
  /** Whether the pointer went down on the strip itself rather than on one of its controls. */
  let onStrip = $state(true);

  /** The preview's strip works as its tab would: drag it out or double-click it to detach. */
  const grip: StripGrip = {
    get draggable() {
      return !detached && onStrip;
    },
    get dragging() {
      return dragging;
    },
    onpointerdown: (event) => (onStrip = !onControl(event)),
    ondragstart: (event) => onDragStart(event),
    ondblclick: (event) => !onControl(event) && toggleDetached(),
  };
</script>

{#snippet tab()}
  {#if id === "pdf"}
    <!-- The preview only ever shows the main file's PDF: a title, no tab; the whole strip is the handle. -->
    <div class="title" title={hint}>
      <button class="close" draggable="false" title={m.pane_close()} aria-label={m.pane_close()} onclick={() => panes.close(id)}>
        <X size={13} />
      </button>
      <span class="label">{label}</span>
    </div>
  {:else}
    <!-- Dragging any tab out of the window, or double-clicking it, detaches the whole pane. -->
    <div class="tabs">
      {#if fileTabs.length > 0}
        {#each fileTabs as file (file)}
          {@const image = fileKind(file) === "viewable"}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <div
            class="tab"
            class:active={file === doc.shown}
            class:dragging
            title={file}
            draggable="true"
            onclick={() => file !== doc.shown && doc.openFile(file)}
            onauxclick={(e) => e.button === 1 && doc.closeTab(file)}
            ondblclick={() => tabWindows.detach(file)}
            ondragstart={(e) => onDragStart(e, file)}
          >
            {#if image}<FileImage size={14} />{:else}<Icon size={14} />{/if}
            <span class="label">{fileName(file)}</span>
            <button
              class="close"
              draggable="false"
              title={m.pane_close()}
              aria-label={m.pane_close()}
              onclick={(e) => (e.stopPropagation(), doc.closeTab(file))}
            >
              <X size={13} />
            </button>
          </div>
        {/each}
      {:else}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="tab active"
          class:dragging
          title={hint}
          draggable={!detached}
          ondblclick={toggleDetached}
          ondragstart={(e) => onDragStart(e)}
        >
          <Icon size={14} />
          <span class="label">{label}</span>
          <button class="close" draggable="false" title={m.pane_close()} aria-label={m.pane_close()} onclick={() => panes.close(id)}>
            <X size={13} />
          </button>
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet actions()}
  {#if detached}
    <Button variant="ghost" title={m.pane_dock_title()} aria-label={m.pane_dock_title()} onclick={toggleDetached}>
      <SquareArrowDownLeft size={14} />
    </Button>
  {:else}
    <Button variant="ghost" title={m.pane_detach_title()} aria-label={m.pane_detach_title()} onclick={toggleDetached}>
      <SquareArrowOutUpRight size={14} />
    </Button>
  {/if}
{/snippet}

<!-- The pane draws the strip: its own tools (zoom, …) sit right next to the tab. -->
<div class="frame" class:detached bind:this={frame}>
  {#if id === "editor"}
    <EditorPane {tab} {actions} />
  {:else}
    <PdfPane {tab} {actions} {grip} />
  {/if}
</div>

<style>
  .frame {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }

  .frame.detached {
    height: 100vh;
  }

  .tabs {
    display: flex;
    align-items: flex-end;
    gap: var(--space-1);
    align-self: stretch;
    min-width: 0;
    /* Many tabs scroll sideways (mouse wheel with Shift, or touchpad) instead of wrapping. */
    overflow-x: auto;
    scrollbar-width: none;
  }

  .tab {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-3);
    max-width: 220px;
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

  /* Background tabs sit in the strip; the shown one merges into the content below. */
  .tab:not(.active) {
    border-top-color: var(--border);
    border-bottom-color: var(--border);
    background: transparent;
    color: var(--text-muted);
  }

  .tab:not(.active):hover {
    background: var(--hover);
  }

  .tab.dragging {
    opacity: 0.6;
  }

  .title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    align-self: center;
    min-width: 0;
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
