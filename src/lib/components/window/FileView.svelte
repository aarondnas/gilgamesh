<script lang="ts">
  import type { Component } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { fly } from "svelte/transition";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import FileArchive from "@lucide/svelte/icons/file-archive";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import FolderPlus from "@lucide/svelte/icons/folder-plus";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import Bot from "@lucide/svelte/icons/bot";
  import Printer from "@lucide/svelte/icons/printer";
  import Settings from "@lucide/svelte/icons/settings";
  import { m } from "$lib/paraglide/messages";
  import { doc, type FileSection } from "$lib/state/document.svelte";
  import { project } from "$lib/state/project.svelte";
  import { motionMs } from "$lib/util/motion";
  import AssistantSettings from "../settings/AssistantSettings.svelte";
  import NewProjectPage from "../project/NewProjectPage.svelte";
  import PrintPage from "../pdf/PrintPage.svelte";
  import RecentProjects from "../project/RecentProjects.svelte";
  import SettingsPane from "../settings/SettingsPane.svelte";
  import WindowChoiceDialog from "./WindowChoiceDialog.svelte";

  type Item = { id: FileSection; label: string; icon: Component };

  /** Like Word's backstage: the file commands first, settings at the bottom. */
  const top: Item[] = $derived([
    { id: "new", label: m.ribbon_new(), icon: FolderPlus },
    { id: "open", label: m.ribbon_open(), icon: FolderOpen },
    { id: "print", label: m.file_print(), icon: Printer },
    { id: "ai", label: m.ribbon_assistant(), icon: Bot },
  ]);
  const bottom: Item[] = $derived([{ id: "settings", label: m.tab_settings(), icon: Settings }]);
  const titles: Record<FileSection, () => string> = {
    new: m.ribbon_new,
    open: m.ribbon_open,
    print: m.file_print,
    ai: m.ribbon_assistant,
    settings: m.tab_settings,
  };

  let windowChoice: WindowChoiceDialog;

  /** With a project open here, asks where the next one goes; otherwise this window is free anyway. */
  function openProject() {
    if (project.root) windowChoice.ask();
    else void doc.openProject();
  }
</script>

{#snippet navItem(item: Item, index: number)}
  <button
    class="item"
    class:active={doc.fileSection === item.id}
    aria-current={doc.fileSection === item.id ? "page" : undefined}
    onclick={() => (doc.fileSection = item.id)}
    in:fly|global={{ x: -16, duration: motionMs(260), delay: motionMs(80 + index * 35), easing: cubicOut }}
  >
    <item.icon size={17} strokeWidth={1.75} />
    {item.label}
  </button>
{/snippet}

{#snippet tile(icon: Component, label: string, hint: string, onclick: () => void)}
  {@const Icon = icon}
  <button class="tile" {onclick}>
    <Icon size={28} strokeWidth={1.5} />
    <strong>{label}</strong>
    <span>{hint}</span>
  </button>
{/snippet}

<WindowChoiceDialog
  bind:this={windowChoice}
  title={m.file_open_where()}
  onchoose={(inNewWindow) => void (inNewWindow ? doc.openProjectInWindow() : doc.openProject())}
/>

<div class="file">
  <!--
    Slides in from the left edge, as Word's backstage does: moved, not grown,
    so the content beside it has its final width from the start (a growing
    panel would resize it in every step, and the print preview with it).
  -->
  <nav class="nav" in:fly={{ x: "-100%", opacity: 1, duration: motionMs(280), easing: cubicOut }}>
    <button class="back" title={m.file_back()} aria-label={m.file_back()} onclick={() => doc.leaveFile()}>
      <ArrowLeft size={18} />
    </button>
    {#each top as item, i (item.id)}
      {@render navItem(item, i)}
    {/each}
    <div class="spacer"></div>
    {#each bottom as item, i (item.id)}
      {@render navItem(item, top.length + i)}
    {/each}
  </nav>

  <main class="content">
    {#key doc.fileSection}
      <div class="section" in:fly={{ y: 10, duration: motionMs(220), easing: cubicOut }}>
        {#if doc.fileSection === "ai"}
          <AssistantSettings />
        {:else if doc.fileSection === "settings"}
          <SettingsPane />
        {:else if doc.fileSection === "print"}
          <PrintPage />
        {:else}
          <div class="page">
            <h1>{titles[doc.fileSection]()}</h1>
            {#if doc.fileSection === "new"}
              <p>{m.file_new_text()}</p>
              <NewProjectPage />
            {:else if doc.fileSection === "open"}
              <p>{m.file_open_text()}</p>
              <div class="tiles">
                {@render tile(FolderOpen, m.start_open(), m.file_browse(), openProject)}
                {@render tile(FileArchive, m.start_import(), m.file_import_hint(), () => void doc.importProject())}
                {@render tile(GitBranch, m.git_clone(), m.git_clone_title(), () => (doc.gitProject = "clone"))}
              </div>
              <RecentProjects />
            {/if}
            {#if doc.error}<p class="error">{doc.error}</p>{/if}
          </div>
        {/if}
      </div>
    {/key}
  </main>
</div>

<style>
  .file {
    display: flex;
    height: 100%;
    background: var(--surface);
  }

  .nav {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    width: 200px;
    padding: var(--space-5) 0;
    overflow: hidden;
    background: var(--accent);
    color: var(--on-accent);
    white-space: nowrap;
  }

  .back {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    margin: 0 0 var(--space-6) var(--space-6);
    border: 1px solid var(--on-accent-muted);
    border-radius: var(--radius-pill);
    background: none;
    color: var(--on-accent);
    transition: background-color 150ms ease;
  }

  .back:hover {
    background: var(--on-accent-hover);
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    padding: var(--space-5) var(--space-6);
    border: none;
    border-left: 3px solid transparent;
    background: none;
    color: var(--on-accent-muted);
    font: inherit;
    font-size: var(--font-base);
    text-align: left;
    transition:
      background-color 150ms ease,
      color 150ms ease,
      border-color 150ms ease;
  }

  .item:hover {
    background: var(--on-accent-hover);
    color: var(--on-accent);
  }

  .item.active {
    border-left-color: var(--on-accent);
    background: var(--on-accent-hover);
    color: var(--on-accent);
    font-weight: 600;
  }

  .spacer {
    flex: 1;
  }

  .content {
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .section {
    height: 100%;
  }

  .page {
    height: 100%;
    overflow-y: auto;
    padding: var(--space-8) var(--space-8) var(--space-7);
    box-sizing: border-box;
  }

  .page > * {
    max-width: 720px;
  }

  h1 {
    margin: 0 0 var(--space-4);
    font-size: 28px;
    font-weight: 400;
  }

  p {
    color: var(--text-muted);
    line-height: 1.5;
  }

  .tiles {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
    margin: var(--space-7) 0;
  }

  .tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    width: 180px;
    padding: var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    text-align: left;
    transition:
      border-color 150ms ease,
      background-color 150ms ease,
      transform 150ms ease;
  }

  .tile :global(svg) {
    margin-bottom: var(--space-4);
    color: var(--accent-strong);
  }

  .tile:hover {
    border-color: var(--accent-strong);
    background: var(--hover);
    transform: translateY(-1px);
  }

  .tile:active {
    background: var(--pressed);
    transform: none;
  }

  .tile span {
    font-size: var(--font-sm);
    color: var(--text-muted);
  }

  .error {
    color: var(--error);
    font-size: var(--font-sm);
  }

  @media (prefers-reduced-motion: reduce) {
    .tile:hover {
      transform: none;
    }
  }
</style>
