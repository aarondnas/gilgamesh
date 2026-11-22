<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import Ribbon from "$lib/components/ribbon/Ribbon.svelte";
  import FileView from "$lib/components/window/FileView.svelte";
  import HistoryDialog from "$lib/components/dialogs/HistoryDialog.svelte";
  import ImportDialog from "$lib/components/project/ImportDialog.svelte";
  import ImageDialog from "$lib/components/dialogs/ImageDialog.svelte";
  import TableDialog from "$lib/components/dialogs/TableDialog.svelte";
  import LinkDialog from "$lib/components/dialogs/LinkDialog.svelte";
  import MarginsDialog from "$lib/components/dialogs/MarginsDialog.svelte";
  import CitationDialog from "$lib/components/dialogs/CitationDialog.svelte";
  import FontDialog from "$lib/components/dialogs/FontDialog.svelte";
  import SymbolDialog from "$lib/components/dialogs/SymbolDialog.svelte";
  import HeaderFooterDialog from "$lib/components/dialogs/HeaderFooterDialog.svelte";
  import TitleDialog from "$lib/components/dialogs/TitleDialog.svelte";
  import ListDialog from "$lib/components/dialogs/ListDialog.svelte";
  import GitProjectDialog from "$lib/components/git/GitProjectDialog.svelte";
  import PaneFrame from "$lib/components/window/PaneFrame.svelte";
  import ProjectSidebar from "$lib/components/project/ProjectSidebar.svelte";
  import ProjectStart from "$lib/components/project/ProjectStart.svelte";
  import StatusBar from "$lib/components/window/StatusBar.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import type { WindowStart } from "$lib/api";
  import { startAssistantTools } from "$lib/mcp/assistant.svelte";
  import { m } from "$lib/paraglide/messages";
  import { handleShortcut, refuseContextMenu, refuseFiles, refuseZoomIn } from "$lib/components/window/shortcuts";
  import { doc } from "$lib/state/document.svelte";
  import { build } from "$lib/state/build.svelte";
  import { packages } from "$lib/state/packages.svelte";
  import { panes } from "$lib/state/panes.svelte";
  import { project } from "$lib/state/project.svelte";
  import { updates } from "$lib/state/updates.svelte";

  /** As the divider's grid column in `.panes.split`. */
  const DIVIDER_WIDTH = 5;
  const MIN_SPLIT = 0.2;
  const MAX_SPLIT = 0.8;

  let paneArea: HTMLDivElement | undefined = $state();
  /** Last width of the pane area while visible; 0 while hidden, which must not move the divider. */
  let areaWidth = $state(0);

  $effect(() => {
    if (!paneArea) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) areaWidth = entry.contentRect.width;
    });
    observer.observe(paneArea);
    return () => observer.disconnect();
  });

  /** Unless the user moved the divider, the preview is exactly as wide as a whole page needs, on any screen. */
  const split = $derived.by(() => {
    if (panes.manualSplit !== null) return panes.manualSplit;
    if (!panes.pdfFitWidth || !areaWidth) return 0.5;
    const editor = (areaWidth - DIVIDER_WIDTH - panes.pdfFitWidth) / areaWidth;
    return Math.min(Math.max(editor, MIN_SPLIT), MAX_SPLIT);
  });

  const editorDocked = $derived(panes.mode.editor === "docked");
  const pdfDocked = $derived(panes.mode.pdf === "docked");

  onMount(startAssistantTools);
  // Pinches reach the page (see `pinch.rs`); only the editor and the PDF preview zoom by them.
  onMount(() => refuseZoomIn(window));
  onMount(() => doc.listenForChanges());
  onMount(() => updates.start());

  onMount(async () => {
    await packages.init();
    // Set by the backend for further main windows (see `window/mod.rs`); the first one reopens the last project.
    const start = (window as { __GILGAMESH_START__?: WindowStart | null }).__GILGAMESH_START__;
    if (start) await doc.start(start);
    else if (getCurrentWindow().label === "main") await doc.restore();
    // Installed before the choice was asked for (or by an older version): ask once, in the first window.
    if (getCurrentWindow().label === "main") void build.offerAutoInstall();
  });

  // Detached panes show the project, so their windows return once one is open.
  $effect(() => {
    if (project.root) void panes.restoreWindows();
  });

  function startResize(event: PointerEvent) {
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      if (!paneArea) return;
      const rect = paneArea.getBoundingClientRect();
      panes.manualSplit = Math.min(Math.max((e.clientX - rect.left) / rect.width, MIN_SPLIT), MAX_SPLIT);
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
  }
</script>

<!-- Files dropped anywhere but the project explorer would make the webview open them. -->
<svelte:window onkeydown={handleShortcut} ondragover={refuseFiles} ondrop={refuseFiles} oncontextmenu={refuseContextMenu} />

<div class="app">
  <Ribbon />

  <!--
    The workspace stays mounted and keeps its size while the File tab covers it:
    hidden with display: none it would lose its size, and coming back the PDF
    preview would draw every page again and the editor measure itself anew.
  -->
  <div class="stage">
    <div class="workspace" class:covered={doc.tab === "file"} inert={doc.tab === "file"}>
      {#if project.root}
        <ProjectSidebar />
        <div
          class="panes"
          class:split={editorDocked && pdfDocked}
          class:animating={panes.animatingSplit}
          bind:this={paneArea}
          style:--split={split}
        >
          {#if editorDocked}
            <div class="pane"><PaneFrame id="editor" /></div>
          {/if}
          {#if editorDocked && pdfDocked}
            <div
              class="divider"
              role="separator"
              aria-orientation="vertical"
              title={m.pane_divider_title()}
              onpointerdown={startResize}
              ondblclick={() => panes.fitPage()}
            ></div>
          {/if}
          {#if pdfDocked}
            <div class="pane"><PaneFrame id="pdf" /></div>
          {/if}
          {#if !editorDocked && !pdfDocked}
            <div class="no-panes">
              <p>{m.pane_none_docked()}</p>
              <Button variant="secondary" onclick={() => panes.reset()}>{m.pane_reset()}</Button>
            </div>
          {/if}
        </div>
      {:else}
        <main class="page"><ProjectStart /></main>
      {/if}
    </div>
  </div>

  <StatusBar />

  {#if doc.tab === "file"}
    <div class="page cover"><FileView /></div>
  {/if}

  <!-- The files are saved for an update: nothing typed now would be, so the window takes no input until Gilgamesh ends. -->
  {#if updates.closing}
    <div class="updating" role="alert">
      <p>{m.update_closing()}</p>
    </div>
  {/if}
</div>

<ImportDialog />
<GitProjectDialog />
<HistoryDialog />
<ListDialog />
<ImageDialog />
<TableDialog />
<LinkDialog />
<MarginsDialog />
<CitationDialog />
<SymbolDialog />
<FontDialog />
<HeaderFooterDialog />
<TitleDialog />

<style>
  .app {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .workspace {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }

  .panes {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: 1fr;
  }

  .panes.split {
    grid-template-columns: calc(var(--split) * 100%) 5px 1fr;
  }

  /* Only for `panes.fitPage`: dragging the divider must follow the pointer without delay. */
  .panes.split.animating {
    transition: grid-template-columns 320ms cubic-bezier(0.2, 0, 0, 1);
  }

  @media (prefers-reduced-motion: reduce) {
    .panes.split.animating {
      transition: none;
    }
  }

  .workspace.covered {
    visibility: hidden;
  }

  /*
   * The File tab lies over the ribbon's panel and the workspace, from below the
   * tab row to the status bar, instead of taking their place: nothing below
   * changes its size, so nothing is laid out or drawn anew.
   */
  .cover {
    position: absolute;
    inset: var(--tabbar-height) 0 var(--statusbar-height) 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
  }

  .pane {
    min-width: 0;
    min-height: 0;
  }

  .no-panes {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-5);
    padding: var(--space-7);
    background: var(--canvas);
    color: var(--text-muted);
    text-align: center;
  }

  .no-panes p {
    margin: 0;
  }

  .divider {
    background: var(--border);
    touch-action: none;
  }

  .divider:hover {
    background: var(--accent-strong);
  }

  .page {
    flex: 1;
    min-height: 0;
  }

  .updating {
    position: absolute;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--surface) 85%, transparent);
  }

  .updating p {
    margin: 0;
    padding: var(--space-5) var(--space-7);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    font-size: var(--font-md);
  }
</style>
