<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Play from "@lucide/svelte/icons/play";
  import Redo2 from "@lucide/svelte/icons/redo-2";
  import Save from "@lucide/svelte/icons/save";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import { m } from "$lib/paraglide/messages";
  import { actions } from "$lib/state/actions.svelte";
  import { build } from "$lib/state/build.svelte";
  import { doc, type Tab } from "$lib/state/document.svelte";
  import { formatting } from "$lib/state/formatting.svelte";
  import { packages } from "$lib/state/packages.svelte";
  import { project } from "$lib/state/project.svelte";
  import { tabSlide } from "../ui/tab-motion";
  import EditTab from "./tabs/EditTab.svelte";
  import InsertTab from "./tabs/InsertTab.svelte";
  import LayoutTab from "./tabs/LayoutTab.svelte";
  import StartTab from "./tabs/StartTab.svelte";
  import WindowTab from "./tabs/WindowTab.svelte";
  import WindowControls from "./WindowControls.svelte";

  const tabs: { id: Tab; label: string }[] = $derived([
    { id: "file", label: m.tab_file() },
    { id: "start", label: m.tab_start() },
    { id: "edit", label: m.tab_edit() },
    { id: "insert", label: m.tab_insert() },
    { id: "layout", label: m.tab_layout() },
    { id: "window", label: m.tab_window() },
  ]);

  /**
   * The "File" tab has no tools: the File page lies over the panel, which keeps
   * the last tab's tools and its height. Folding it away would change the
   * workspace's height step by step, and the editor and preview below would
   * be laid out anew in every step.
   */
  const ribbonTab = $derived(doc.tab === "file" ? doc.returnTab : doc.tab);

  /** Clicking the active tab again folds the panel away; switching to another tab unfolds it. */
  let collapsed = $state(false);

  const folded = $derived(collapsed);

  // Not on the way to or from "File", which leaves the panel as it was.
  $effect(() => {
    void ribbonTab;
    collapsed = false;
  });

  function select(id: Tab) {
    if (id === "file") {
      if (doc.tab === "file") doc.leaveFile();
      else doc.showFile();
    } else if (doc.tab === id) collapsed = !collapsed;
    else doc.tab = id;
  }

  /**
   * The new tab's tools slide in from the side the tab lies on, relative to the previous one.
   * Coming from "File", the leftmost tab, they always slide in from the right.
   */
  const slideIn = tabSlide(() => tabs.findIndex((t) => t.id === doc.tab));

  // The base size the points are shown for: after opening a project and after each build (the preamble may have changed).
  $effect(() => {
    void project.config.main;
    void build.lastResult;
    void formatting.refreshBaseFontSize();
  });
</script>

<header class="ribbon">
  <!-- Also the window's title bar: its free area moves the window, a double click maximizes it. -->
  <div class="tabs" data-tauri-drag-region>
    <!-- The sign of the app icon (src-tauri/app-icon.svg) without its tile: DINGIR, the cuneiform sign that opens the name. -->
    <span class="brand" title="Gilgamesh" data-tauri-drag-region>
      <svg viewBox="0 0 1024 1024" role="img" aria-label="Gilgamesh">
        <defs>
          <path id="brand-wedge" d="M-110,-420 L110,-420 L40,-290 Q30,60 22,400 L-22,400 Q-30,60 -40,-290 Z" />
        </defs>
        <g transform="translate(540 540) scale(1.1)">
          <use href="#brand-wedge" />
          <use href="#brand-wedge" transform="rotate(-90)" />
          <use href="#brand-wedge" transform="rotate(-45) scale(0.86)" />
          <use href="#brand-wedge" transform="rotate(-135) scale(0.86)" />
        </g>
      </svg>
    </span>
    <div class="tablist" role="tablist">
      {#each tabs as tab (tab.id)}
        <button
          role="tab"
          class="tab"
          class:active={doc.tab === tab.id}
          class:file-open={tab.id === "file" && doc.tab === "file"}
          aria-selected={doc.tab === tab.id}
          aria-expanded={doc.tab === tab.id && tab.id !== "file" ? !collapsed : undefined}
          onclick={() => select(tab.id)}
        >
          {tab.label}
        </button>
      {/each}
    </div>
    <!-- Undo, redo, saving and compiling stay at hand on every tab, as in Word's quick access toolbar. -->
    <div class="quick">
      <button title={m.ribbon_undo_title()} aria-label={m.ribbon_undo()} disabled={!actions.canUndo} onclick={() => doc.undo()}>
        <Undo2 size={16} strokeWidth={1.75} />
      </button>
      <button title={m.ribbon_redo_title()} aria-label={m.ribbon_redo()} disabled={!actions.canRedo} onclick={() => doc.redo()}>
        <Redo2 size={16} strokeWidth={1.75} />
      </button>
      <button title={m.ribbon_save_title()} aria-label={m.shortcut_save()} disabled={!project.unsaved} onclick={() => void doc.save()}>
        <Save size={16} strokeWidth={1.75} />
      </button>
      <button
        title={m.ribbon_compile_title()}
        aria-label={m.ribbon_compile()}
        disabled={!packages.installed || !project.config.main}
        onclick={() => build.compile()}
      >
        {#if build.building}
          <LoaderCircle size={16} strokeWidth={1.75} class="spin" />
        {:else}
          <Play size={16} strokeWidth={1.75} />
        {/if}
      </button>
    </div>
    <WindowControls />
  </div>

  <div class="panel" class:collapsed={folded} role="tabpanel" inert={folded || doc.tab === "file"}>
    <!--
      Keyed by the selected tab, not by the tools shown: leaving "File" slides the
      tools in also when it returns to the tab they belong to (the back arrow).
    -->
    {#key doc.tab}
      <div class="groups" in:slideIn>
        {#if ribbonTab === "start"}
          <StartTab />
        {:else if ribbonTab === "edit"}
          <EditTab />
        {:else if ribbonTab === "insert"}
          <InsertTab />
        {:else if ribbonTab === "layout"}
          <LayoutTab />
        {:else}
          <WindowTab />
        {/if}
      </div>
    {/key}
  </div>
</header>

<style>
  /* The tabs' content (tabs/*.svelte) shares these, applied from here. */
  /* The paper menu's preview: the paper's name over its size. */
  .groups :global(.paper-caption) {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    color: var(--text-muted);
    font-size: var(--font-xs);
    font-variant-numeric: tabular-nums;
  }

  .groups :global(.paper-caption strong) {
    color: var(--text);
    font-size: var(--font-sm);
  }

  /* The styles gallery: each name set as the style looks in the document. */
  .groups :global(.styles) {
    display: grid;
    grid-template-columns: repeat(2, auto);
    gap: 2px;
    align-content: center;
  }

  /* The heading's numbering above the document's, as high as the gallery's two rows. */
  .groups :global(.numbering) {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
  }

  .groups :global(.style) {
    min-width: 92px;
    height: 24px;
    padding: 0 var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    line-height: 1;
    text-align: left;
    white-space: nowrap;
  }

  .groups :global(.style:hover:not(:disabled)) {
    background: var(--hover);
  }

  .groups :global(.style.active) {
    border-color: var(--accent-strong);
    box-shadow: inset 0 0 0 1px var(--accent-strong);
  }

  .groups :global(.style:disabled) {
    opacity: 0.45;
  }

  .ribbon {
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    user-select: none;
  }

  .tabs {
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
    height: var(--tabbar-height);
    /* No padding on the right: the window buttons reach the edge, as in Windows. */
    padding: 0 0 0 var(--space-4);
    background: var(--accent);
  }

  .tablist {
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
  }

  /* On the tab row, set apart from the tabs; aligned with their text. */
  .quick {
    display: flex;
    align-items: center;
    gap: 2px;
    margin: var(--space-3) 0 0 var(--space-5);
    padding-left: var(--space-3);
    border-left: 1px solid var(--on-accent-hover);
  }

  .quick button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--on-accent);
  }

  .quick button:hover:not(:disabled) {
    background: var(--on-accent-hover);
  }

  .quick button:disabled {
    color: var(--on-accent-muted);
    opacity: 0.6;
  }

  .brand {
    display: flex;
    align-items: center;
    padding: 0 var(--space-5) 0 var(--space-2);
    color: var(--on-accent);
  }

  .brand svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
    /* Clicks fall through to the drag region. */
    pointer-events: none;
  }

  .tab {
    position: relative;
    margin-top: var(--space-3);
    padding: 0 var(--space-5);
    border: none;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    background: transparent;
    color: var(--on-accent-muted);
    font: inherit;
    font-size: var(--font-md);
    transition:
      background-color 180ms ease,
      color 180ms ease;
  }

  .tab:hover {
    color: var(--on-accent);
    background: var(--on-accent-hover);
  }

  .tab.active {
    background: var(--surface-2);
    color: var(--accent-strong);
    font-weight: 600;
  }

  /*
   * The File page lies over everything below the tab row (see `+page.svelte`).
   * The ribbon's lower edge stays visible from the File tab's left end to the
   * window's right edge, not below the app icon. Above the page, which sits at z-index 5.
   */
  .tab.file-open::after {
    content: "";
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 6;
    width: 100vw;
    height: 1px;
    background: #fff;
    pointer-events: none;
  }

  .panel {
    display: flex;
    height: var(--ribbon-height);
    padding: var(--space-3) 0 var(--space-2);
    overflow: hidden;
    transition:
      height 220ms cubic-bezier(0.2, 0, 0, 1),
      padding 220ms cubic-bezier(0.2, 0, 0, 1),
      opacity 160ms ease;
  }

  .groups {
    display: flex;
    min-width: 0;
  }

  .panel.collapsed {
    height: 0;
    padding-block: 0;
    opacity: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .panel,
    .tab {
      transition: none;
    }
  }

  .groups :global(.stack) {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2);
  }

  .groups :global(.pair) {
    display: flex;
    align-items: center;
  }

  .groups :global(.format) {
    display: grid;
    grid-template-columns: repeat(3, auto);
    align-content: space-evenly;
    gap: var(--space-1);
  }

  .groups :global(.format .ribbon-button) {
    padding: 3px var(--space-3);
  }

  /* As high as a row of the small buttons. */
  .groups :global(.font-family),
  .groups :global(.font-size) {
    height: 24px;
    padding: 0 var(--space-3);
    font-size: var(--font-sm);
  }

  /*
   * As in Word: the font and its size above, the emphases below; beside each,
   * as a symbol, what it acts on.
   */
  .groups :global(.format.font),
  .groups :global(.format.paragraph) {
    display: flex;
    flex-direction: column;
    justify-content: space-evenly;
  }

  .groups :global(.format.font .row),
  .groups :global(.format.paragraph .row) {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  /*
   * A function and the scope it acts on, on one background, so it is clear
   * which list belongs to which buttons.
   */
  .groups :global(.scoped) {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 1px;
    border-radius: var(--radius-lg);
    background: var(--scope-group);
  }

  /* Room between a group and what is beside it; the buttons within a row stay close. */
  .groups :global(.row > * + .scoped),
  .groups :global(.row > .scoped + *) {
    margin-left: var(--space-2);
  }

  .groups :global(.format.font .font-family) {
    width: 170px;
    text-overflow: ellipsis;
  }

  /* The font list's little space before "More fonts …" (see there). */
  .groups :global(.font-family .gap) {
    font-size: 4px;
  }

  /* The emphases' row fills the group's width, its colours pushed to the right. */
  .groups :global(.format.font .emphasis) {
    flex: 1;
  }

  .groups :global(.format.font .colors) {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-left: auto;
  }

  .groups :global(.review-nav) {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  .groups :global(.review-count) {
    font-size: var(--font-xs);
    font-variant-numeric: tabular-nums;
    color: var(--text);
    white-space: nowrap;
  }

  .groups :global(.review-count.none) {
    color: var(--text-muted);
  }

  .groups :global(.options) {
    padding: 0 var(--space-3);
    font-size: var(--font-sm);
  }

  .groups :global(.options label) {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
</style>
