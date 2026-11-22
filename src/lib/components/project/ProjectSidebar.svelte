<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import FileIcon from "@lucide/svelte/icons/file";
  import FilePlus from "@lucide/svelte/icons/file-plus";
  import FileImage from "@lucide/svelte/icons/file-image";
  import FileText from "@lucide/svelte/icons/file-text";
  import Folder from "@lucide/svelte/icons/folder";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import FolderPlus from "@lucide/svelte/icons/folder-plus";
  import Check from "@lucide/svelte/icons/check";
  import History from "@lucide/svelte/icons/history";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import SquarePlus from "@lucide/svelte/icons/square-plus";
  import House from "@lucide/svelte/icons/house";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { SvelteSet } from "svelte/reactivity";
  import GitView from "../git/GitView.svelte";
  import Outline from "./Outline.svelte";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import { motionMs, prefersReducedMotion } from "$lib/util/motion";
  import { slideFrom } from "../ui/tab-motion";
  import { cubicOut } from "svelte/easing";
  import { fade, scale } from "svelte/transition";
  import { errorMessage, type TreeEntry } from "$lib/api";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import { fileKind, opensInTab } from "$lib/config/project-files";
  import { carriesFiles, droppedFiles } from "$lib/util/dropped-files";
  import { project } from "$lib/state/project.svelte";
  import { fileName, isWithin, parentDir } from "$lib/util/paths";
  import { review } from "$lib/state/review.svelte";
  import { changes } from "$lib/state/changes.svelte";
  import Button from "../ui/Button.svelte";

  const INDENT = 12;

  const collapsed = $derived(settings.data.sidebarCollapsed);
  /** How long folding the explorer in or out takes; matches the width transition in the styles. */
  const FOLD_MS = 220;
  /** The explorer's widest (and default) width, in pixels. */
  const MAX_WIDTH = 240;
  /** Widest of the view names in the current language, and the row they sit in with its arrows. */
  let labelWidth = $state(0);
  let rowWidth = $state(0);
  let nameWidth = $state(0);
  /**
   * The explorer gets no narrower than the widest view name needs to be read
   * whole beside its arrows; until that is measured, no narrower than 80 px.
   */
  const minWidth = $derived(labelWidth ? Math.min(Math.ceil(labelWidth + rowWidth - nameWidth) + 2, MAX_WIDTH) : 80);
  /** Width while its right edge is being dragged; the setting is written when the drag ends. */
  let dragWidth = $state<number | null>(null);
  const width = $derived(Math.min(Math.max(dragWidth ?? settings.data.sidebarWidth ?? MAX_WIDTH, minWidth), MAX_WIDTH));
  /** The explorer's views, in the order the arrows step through them. */
  const VIEWS = ["files", "outline", "git"] as const;
  type View = (typeof VIEWS)[number];
  let view = $state<View>("files");
  /** Which way the last step went: the new view slides in from that side. */
  let direction = $state<1 | -1>(1);
  const viewLabel = (v: View) => (v === "files" ? m.sidebar_files() : v === "outline" ? m.sidebar_outline() : "Git");

  /** Shows the next view to the right (1) or left (-1), going round at the ends. */
  function step(by: 1 | -1) {
    direction = by;
    view = VIEWS[(VIEWS.indexOf(view) + by + VIEWS.length) % VIEWS.length];
  }

  function show(target: View) {
    if (target === view) return;
    direction = VIEWS.indexOf(target) > VIEWS.indexOf(view) ? 1 : -1;
    view = target;
  }

  const slideIn = (node: Element) => slideFrom(node, direction);

  function startResize(event: PointerEvent) {
    const handle = event.currentTarget as HTMLElement;
    const left = handle.parentElement!.getBoundingClientRect().left;
    handle.setPointerCapture(event.pointerId);
    dragWidth = width;
    const move = (e: PointerEvent) => (dragWidth = Math.round(e.clientX - left));
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      settings.update({ sidebarWidth: width === MAX_WIDTH ? null : width });
      dragWidth = null;
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }
  const expanded = new SvelteSet<string>();
  /** Last clicked entry; new files and folders go into it (or next to it). */
  let selected = $state<{ path: string; isDir: boolean } | null>(null);
  let creating = $state<{ kind: "file" | "folder"; dir: string } | null>(null);
  let name = $state("");
  let createError = $state<string | null>(null);
  /** Entry being renamed in place. */
  let renaming = $state<{ path: string; value: string; error: string | null } | null>(null);
  /** Right-click menu; `entry` is null for the empty area (project root). */
  let menu = $state<{ x: number; y: number; entry: TreeEntry | null } | null>(null);
  let dragging = $state<string | null>(null);
  /** Folder under the pointer while dragging; "" is the project root. */
  let dropTarget = $state<string | null>(null);

  const targetDir = $derived(selected ? (selected.isDir ? selected.path : parentDir(selected.path)) : "");

  /**
   * The tree with the files the AI deleted put back in, so they can be
   * reviewed where they were; `ghosts` are those and folders that went with them.
   */
  const shown = $derived.by(() => {
    const ghosts = new Set<string>();
    const sorted = (list: TreeEntry[]) =>
      list.toSorted((a, b) => Number(!a.isDir) - Number(!b.isDir) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    const insert = (list: TreeEntry[], path: string, dir: string): TreeEntry[] => {
      const rest = path.slice(dir ? dir.length + 1 : 0);
      const name = rest.split("/")[0];
      const at = dir ? `${dir}/${name}` : name;
      if (at === path) {
        if (list.some((e) => e.path === path)) return list;
        ghosts.add(path);
        return sorted([...list, { name, path, isDir: false, children: [] }]);
      }
      const folder = list.find((e) => e.isDir && e.path === at);
      if (!folder) ghosts.add(at);
      const updated = { name, path: at, isDir: true, children: insert(folder?.children ?? [], path, at) };
      return sorted([...list.filter((e) => e !== folder), updated]);
    };
    let tree = project.tree;
    for (const path of Object.keys(review.deleted)) tree = insert(tree, path, "");
    return { tree, ghosts };
  });

  /** Folders with AI changes awaiting review somewhere inside. */
  const pendingInside = $derived.by(() => {
    const folders = new Set<string>();
    for (const file of [...Object.keys(review.files), ...Object.keys(review.deleted)]) {
      for (let dir = parentDir(file); dir; dir = parentDir(dir)) folders.add(dir);
    }
    return folders;
  });

  /** Folders with a file inside that an assistant, or the app away from the editor, changed a moment ago. */
  const touchedInside = $derived.by(() => {
    const folders = new Set<string>();
    for (const file of [...review.touched, ...changes.files]) {
      for (let dir = parentDir(file); dir; dir = parentDir(dir)) folders.add(dir);
    }
    return folders;
  });

  /**
   * A row leaving the tree because its review ended (a new file rejected, a
   * deletion accepted) folds away; any other row goes at once, e.g. when
   * another project opens.
   */
  function foldAway(_node: Element, path: string) {
    if (prefersReducedMotion() || !review.settled.has(path)) return { duration: 0 };
    return {
      duration: 260,
      easing: cubicOut,
      css: (t: number) => `opacity: ${t}; height: ${t * 24}px; transform: translateX(${(1 - t) * -12}px)`,
    };
  }

  function reviewTitle(path: string): string | null {
    const kind = review.kindOf(path);
    if (kind === "created") return m.sidebar_ai_created();
    if (kind === "deleted") return m.sidebar_ai_deleted();
    return kind === "modified" ? m.sidebar_ai_modified() : null;
  }

  // A different project starts with a clean slate.
  $effect(() => {
    void project.root;
    expanded.clear();
    selected = null;
    creating = null;
    renaming = null;
    menu = null;
  });

  function click(entry: TreeEntry) {
    selected = { path: entry.path, isDir: entry.isDir };
    if (entry.isDir) {
      if (expanded.has(entry.path)) expanded.delete(entry.path);
      else expanded.add(entry.path);
    } else if (opensInTab(entry.path)) {
      void doc.openFile(entry.path);
    }
  }

  function startCreate(kind: "file" | "folder", dir = targetDir) {
    menu = null;
    // The name is typed into the file tree, which the outline would hide.
    show("files");
    creating = { kind, dir };
    if (dir) expanded.add(dir);
    name = "";
    createError = null;
  }

  async function submitCreate() {
    if (!creating) return;
    const { kind, dir } = creating;
    try {
      if (kind === "file") {
        await doc.createFile(dir, name);
      } else {
        const path = await doc.createFolder(dir, name);
        expanded.add(path);
        selected = { path, isDir: true };
      }
      creating = null;
    } catch (err) {
      createError = errorMessage(err);
    }
  }

  function onInputKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") void submitCreate();
    else if (event.key === "Escape") creating = null;
  }

  function autofocus(node: HTMLInputElement) {
    node.focus();
    // Select the name without extension, like file managers do.
    const dot = node.value.lastIndexOf(".");
    node.setSelectionRange(0, dot > 0 ? dot : node.value.length);
  }

  /**
   * Closes the menu, then acts on its entry. The entry is read first: the
   * menu's `entry` is derived from `menu` and is gone once the menu is.
   */
  function fromMenu(action: (entry: TreeEntry) => unknown) {
    const entry = menu?.entry;
    menu = null;
    if (entry) void action(entry);
  }

  function startRename(entry: TreeEntry) {
    menu = null;
    renaming = { path: entry.path, value: entry.name, error: null };
  }

  async function submitRename() {
    if (!renaming) return;
    const { path, value } = renaming;
    const name = fileName(path);
    if (value.trim() === name) {
      renaming = null;
      return;
    }
    try {
      const moved = await doc.renameEntry(path, value);
      if (expanded.has(path)) {
        expanded.delete(path);
        expanded.add(moved);
      }
      selected = selected?.path === path ? { ...selected, path: moved } : selected;
      renaming = null;
    } catch (err) {
      renaming = { path, value, error: errorMessage(err) };
    }
  }

  function onRenameKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Enter") void submitRename();
    else if (event.key === "Escape") renaming = null;
  }

  function remove(entry: TreeEntry) {
    menu = null;
    void doc.deleteEntry(entry.path);
  }

  function onRowKeydown(event: KeyboardEvent, entry: TreeEntry) {
    if (event.key === "Enter") click(entry);
    else if (shown.ghosts.has(entry.path)) return;
    else if (event.key === "F2") startRename(entry);
    else if (event.key === "Delete") remove(entry);
  }

  function openMenu(event: MouseEvent, entry: TreeEntry | null) {
    event.preventDefault();
    event.stopPropagation();
    if (entry) selected = { path: entry.path, isDir: entry.isDir };
    menu = { x: event.clientX, y: event.clientY, entry };
  }

  // Dragging: a file or folder can go into any folder except its own and its descendants.
  function canDrop(dir: string): boolean {
    return dragging !== null && dir !== parentDir(dragging) && !isWithin(dir, dragging) && !shown.ghosts.has(dir);
  }

  /** Files dragged in from the system's file manager are copied into any folder. */
  const isImport = (event: DragEvent) => dragging === null && carriesFiles(event);

  function onDragOver(event: DragEvent, dir: string) {
    const importing = isImport(event);
    if (!importing && !canDrop(dir)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = importing ? "copy" : "move";
    dropTarget = dir;
  }

  function onDragLeave(event: DragEvent) {
    // Outside drags end without a dragend here, so clear the highlight on leaving the tree.
    const tree = event.currentTarget as HTMLElement;
    if (!(event.relatedTarget instanceof Node && tree.contains(event.relatedTarget))) dropTarget = null;
  }

  function onDrop(event: DragEvent, dir: string) {
    event.preventDefault();
    event.stopPropagation();
    if (isImport(event) && event.dataTransfer) {
      dropTarget = null;
      if (dir) expanded.add(dir);
      void droppedFiles(event.dataTransfer).then((files) => doc.importFiles(dir, files));
      return;
    }
    const path = dragging;
    const allowed = canDrop(dir);
    dragging = dropTarget = null;
    if (path === null || !allowed) return;
    if (dir) expanded.add(dir);
    void doc.moveEntry(path, dir);
  }
</script>

<svelte:window
  onfocus={() => void project.refreshTree().catch(() => {})}
  onclick={() => (menu = null)}
  onblur={() => (menu = null)}
  onkeydown={(e) => e.key === "Escape" && (menu = null)}
/>

<!-- One element whose width glides to nothing; the panel fades inside it. Folded from the status bar. -->
<aside
  class="sidebar"
  class:collapsed
  class:still={prefersReducedMotion() || dragWidth !== null}
  style:width={collapsed ? undefined : `${width}px`}
>
  {#if !collapsed}
    <div class="panel" style:width="{width}px" transition:fade={{ duration: motionMs(FOLD_MS) }}>
      <header>
        <span class="title" title={project.root}>{project.name}</span>
        <Button variant="ghost" title={m.sidebar_new_file()} onclick={() => startCreate("file")}>
          <FilePlus size={15} />
        </Button>
        <Button variant="ghost" title={m.sidebar_new_folder()} onclick={() => startCreate("folder")}>
          <FolderPlus size={15} />
        </Button>
      </header>

      <!-- One view's name at a time; the arrows step through them, going round at the ends. -->
      <div class="views" bind:offsetWidth={rowWidth}>
        <Button variant="ghost" title={m.sidebar_previous_view()} onclick={() => step(-1)}>
          <ChevronLeft size={15} />
        </Button>
        <span class="view-name" aria-live="polite" bind:offsetWidth={nameWidth}>
          <!-- All names on top of each other, unseen: as wide as the widest, for the narrowest width. -->
          <span class="measure" aria-hidden="true" bind:offsetWidth={labelWidth}>
            {#each VIEWS as v (v)}<span>{viewLabel(v)}</span>{/each}
          </span>
          {#key view}
            <span in:slideIn>{viewLabel(view)}</span>
          {/key}
        </span>
        <Button variant="ghost" title={m.sidebar_next_view()} onclick={() => step(1)}>
          <ChevronRight size={15} />
        </Button>
      </div>

      <!-- The new view slides in from the side of the arrow that was clicked. -->
      {#key view}
        <div class="view" in:slideIn>
          {#if view === "outline"}
            <Outline />
          {:else if view === "git"}
            <GitView />
          {:else}
            <div
              class="tree"
              class:drop-target={dropTarget === ""}
              role="tree"
              tabindex="-1"
              oncontextmenu={(e) => openMenu(e, null)}
              ondragover={(e) => onDragOver(e, "")}
              ondragleave={onDragLeave}
              ondrop={(e) => onDrop(e, "")}
              onscroll={() => (menu = null)}
            >
              {@render entries(shown.tree, "", 0)}
              {#if project.tree.length === 0 && !creating}
                <p class="hint">{m.sidebar_empty()}</p>
              {/if}
            </div>
          {/if}
        </div>
      {/key}
    </div>
    <!-- Dragging the right edge makes the explorer narrower, up to its full width. -->
    <div
      class="resize"
      role="separator"
      aria-orientation="vertical"
      title={m.sidebar_resize()}
      onpointerdown={startResize}
      ondblclick={() => settings.update({ sidebarWidth: null })}
    ></div>
  {/if}
</aside>

{#if menu}
  {@const entry = menu.entry}
  <div class="menu" role="menu" tabindex="-1" style:left="{menu.x}px" style:top="{menu.y}px">
    {#if entry && !entry.isDir && entry.path in review.deleted}
      <button role="menuitem" onclick={() => fromMenu((e) => review.restoreDeleted(e.path))}>
        <Undo2 size={14} />{m.sidebar_restore()}
      </button>
      <button role="menuitem" onclick={() => fromMenu((e) => review.acceptDeletion(e.path))}>
        <Check size={14} />{m.sidebar_accept_deletion()}
      </button>
    {:else if entry && shown.ghosts.has(entry.path)}
      <!-- A folder that went with deleted files: nothing to do with it but review them. -->
      <p class="menu-note">{m.sidebar_ai_deleted()}</p>
    {:else}
      {#if !entry || entry.isDir}
        <button role="menuitem" onclick={() => startCreate("file", entry?.path ?? "")}>
          <FilePlus size={14} />{m.sidebar_new_file_here()}
        </button>
        <button role="menuitem" onclick={() => startCreate("folder", entry?.path ?? "")}>
          <FolderPlus size={14} />{m.sidebar_new_folder_here()}
        </button>
      {/if}
      {#if entry && !entry.isDir && entry.name.endsWith(".tex") && entry.path !== project.config.main}
        <button role="menuitem" onclick={() => fromMenu((e) => doc.setMain(e.path))}>
          <House size={14} />{m.sidebar_set_main()}
        </button>
      {/if}
      {#if entry && !entry.isDir && opensInTab(entry.path)}
        <button role="menuitem" onclick={() => fromMenu((e) => doc.openFile(e.path, true))}>
          <SquarePlus size={14} />{m.sidebar_open_in_tab()}
        </button>
      {/if}
      {#if entry && !entry.isDir && fileKind(entry.path) === "editable"}
        <button role="menuitem" onclick={() => fromMenu((e) => (doc.historyFor = e.path))}>
          <History size={14} />{m.history_open()}
        </button>
      {/if}
      {#if entry}
        {#if entry.isDir}<hr />{/if}
        <button role="menuitem" onclick={() => startRename(entry)}>
          <Pencil size={14} />{m.sidebar_rename()}<kbd>F2</kbd>
        </button>
        <button role="menuitem" class="danger" onclick={() => remove(entry)}>
          <Trash2 size={14} />{m.sidebar_delete()}<kbd>{m.key_delete()}</kbd>
        </button>
      {/if}
    {/if}
  </div>
{/if}

{#snippet entries(list: TreeEntry[], dir: string, depth: number)}
  {#if creating?.dir === dir}
    <div class="create" style:padding-left="{depth * INDENT + 8}px">
      <div class="row-input">
        {#if creating.kind === "folder"}<Folder size={14} />{:else}<FileText size={14} />{/if}
        <input
          use:autofocus
          bind:value={name}
          placeholder={creating.kind === "folder" ? m.sidebar_folder_placeholder() : m.sidebar_file_placeholder()}
          onkeydown={onInputKeydown}
          onblur={() => !name.trim() && (creating = null)}
        />
      </div>
      {#if createError}<p class="error">{createError}</p>{/if}
    </div>
  {/if}
  {#each list as entry (entry.path)}
    {@const open = expanded.has(entry.path)}
    {@const editable = !entry.isDir && fileKind(entry.path) === "editable"}
    {@const image = !entry.isDir && fileKind(entry.path) === "viewable"}
    {@const isMain = entry.path === project.config.main}
    {@const gone = shown.ghosts.has(entry.path)}
    {@const aiTitle = entry.isDir ? (pendingInside.has(entry.path) ? m.sidebar_ai_inside() : null) : reviewTitle(entry.path)}
    <div
      class="row"
      class:active={entry.path === doc.shown}
      class:selected={entry.path === selected?.path}
      class:muted={!entry.isDir && !editable && !image}
      class:gone
      class:touched={entry.isDir ? touchedInside.has(entry.path) : review.touched.has(entry.path) || changes.files.has(entry.path)}
      class:new={!entry.isDir && review.touched.has(entry.path) && review.created.has(entry.path)}
      class:accepted={review.settled.get(entry.path) === "accepted"}
      class:rejected={review.settled.get(entry.path) === "rejected" || review.settled.get(entry.path) === "restored"}
      class:restored={review.settled.get(entry.path) === "restored"}
      class:drop-target={dropTarget === entry.path}
      class:dragging={dragging === entry.path}
      style:padding-left="{depth * INDENT + 4}px"
      role="treeitem"
      tabindex="-1"
      out:foldAway={entry.path}
      aria-selected={entry.path === doc.shown}
      aria-expanded={entry.isDir ? open : undefined}
      title={gone ? aiTitle : undefined}
      draggable={!gone && renaming?.path !== entry.path}
      onclick={() => click(entry)}
      onkeydown={(e) => onRowKeydown(e, entry)}
      oncontextmenu={(e) => openMenu(e, entry)}
      ondragstart={(e) => {
        dragging = entry.path;
        e.dataTransfer?.setData("text/plain", entry.path);
      }}
      ondragend={() => (dragging = dropTarget = null)}
      ondragover={(e) => onDragOver(e, entry.isDir ? entry.path : parentDir(entry.path))}
      ondrop={(e) => onDrop(e, entry.isDir ? entry.path : parentDir(entry.path))}
    >
      <span class="chevron" class:open class:hidden={!entry.isDir}><ChevronRight size={13} /></span>
      {#if entry.isDir}
        {#if open}<FolderOpen size={14} />{:else}<Folder size={14} />{/if}
      {:else if editable}
        <FileText size={14} />
      {:else if image}
        <FileImage size={14} />
      {:else}
        <FileIcon size={14} />
      {/if}
      {#if renaming?.path === entry.path}
        <input
          class="rename"
          use:autofocus
          bind:value={renaming.value}
          onkeydown={onRenameKeydown}
          onclick={(e) => e.stopPropagation()}
          onblur={() => !renaming?.error && (renaming = null)}
        />
      {:else}
        <span class="name">{entry.name}</span>
      {/if}
      {#if aiTitle && !gone}
        <span
          class="ai"
          class:inside={entry.isDir}
          title={aiTitle}
          aria-label={aiTitle}
          out:scale={{ duration: motionMs(220), easing: cubicOut }}
        ></span>
      {/if}
      {#if isMain}
        <span class="main" title={m.sidebar_main_file()}><House size={13} /></span>
      {/if}
    </div>
    {#if renaming?.path === entry.path && renaming.error}
      <p class="error" style:padding-left="{depth * INDENT + 4}px">{renaming.error}</p>
    {/if}
    {#if entry.isDir && open}
      {@render entries(entry.children, entry.path, depth + 1)}
    {/if}
  {/each}
{/snippet}

<style>
  /* Folding glides the width; what is inside keeps its own width and is cut off at the edge. */
  .sidebar {
    position: relative;
    flex-shrink: 0;
    width: 240px;
    min-height: 0;
    overflow: hidden;
    border-right: 1px solid var(--border);
    background: var(--surface-2);
    font-size: var(--font-md);
    user-select: none;
    transition: width 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .sidebar.collapsed {
    width: 0;
    border-right-width: 0;
  }

  .sidebar.still {
    transition: none;
  }

  .panel {
    position: absolute;
    inset: 0 auto 0 0;
    display: flex;
    flex-direction: column;
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: var(--toolbar-height);
    padding: 0 var(--space-2) 0 var(--space-5);
    border-bottom: 1px solid var(--border);
  }

  .title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-sm);
    font-weight: 600;
  }

  .views {
    display: flex;
    align-items: center;
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--border);
  }

  .view-name {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--font-sm);
    font-weight: 600;
    text-align: center;
    white-space: nowrap;
  }

  .view-name > span {
    display: inline-block;
  }

  .view-name > .measure {
    position: absolute;
    display: grid;
    visibility: hidden;
    pointer-events: none;
  }

  .measure > span {
    grid-area: 1 / 1;
  }

  /* A thin grip on the right edge; the line lights up while it is hovered or dragged. */
  .resize {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 5px;
    touch-action: none;
  }

  /* The one resize pointer in the app, over the grip and its line (see the pointer rules in app.css). */
  .resize,
  .resize::after {
    cursor: var(--cursor-col-resize) !important;
  }

  /* The grip stays easy to hit; only a thin line at the very edge shows. */
  .resize::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 2px;
  }

  .resize:hover::after,
  .resize:active::after {
    background: var(--accent-strong);
  }

  /* One view at a time; it slides in from the side without a scrollbar flashing up. */
  .view {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .tree {
    flex: 1;
    overflow: auto;
    padding: var(--space-2) 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 24px;
    padding-right: var(--space-3);
    white-space: nowrap;
  }

  .row:hover {
    background: var(--hover);
  }

  .row.selected {
    background: var(--hover);
  }

  .row.active {
    background: var(--pressed);
    color: var(--accent-strong);
    font-weight: 600;
  }

  .row.muted {
    color: var(--text-muted);
  }

  .row :global(svg) {
    flex-shrink: 0;
  }

  .chevron {
    display: flex;
    transition: transform 0.15s;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .chevron.hidden {
    visibility: hidden;
  }

  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .main {
    display: flex;
    color: var(--accent-strong);
  }

  /* AI changes awaiting review: in the file, or somewhere inside the folder. */
  .ai {
    flex-shrink: 0;
    width: 7px;
    height: 7px;
    border-radius: var(--radius-pill);
    background: var(--accent-strong);
  }

  .ai.inside {
    width: 5px;
    height: 5px;
    background: var(--text-muted);
  }

  /* Deleted by the AI, kept until the deletion is accepted or the file restored. */
  .row.gone {
    color: var(--text-muted);
  }

  .row.gone .name {
    text-decoration: line-through;
  }

  /*
   * Changed a moment ago, by an assistant or by the app away from the editor: a band of light runs across the row and
   * its dot pops up; a new file slides in, a deleted one fades to struck through.
   */
  .row {
    position: relative;
  }

  .row.touched::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--accent-strong) 24%, transparent) 50%, transparent 70%)
      no-repeat;
    background-size: 300% 100%;
    animation: row-sweep 1100ms cubic-bezier(0.4, 0, 0.2, 1) both;
  }

  @keyframes row-sweep {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: 0 0;
    }
  }

  /* Its review just ended: a band in the color of the outcome, blue kept, red rejected. */
  .row.accepted::before,
  .row.rejected::before {
    --sweep: var(--accent-strong);
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--sweep) 22%, transparent) 50%, transparent 70%) no-repeat;
    background-size: 300% 100%;
    animation: row-sweep 900ms cubic-bezier(0.4, 0, 0.2, 1) both;
  }

  .row.rejected::before {
    --sweep: var(--error);
  }

  /* A deleted file brought back: its strike-through fades away. */
  .row.restored:not(.gone) .name {
    animation: unstrike 600ms ease-out both;
  }

  @keyframes unstrike {
    from {
      color: var(--text-muted);
      text-decoration: line-through;
    }
    to {
      text-decoration: line-through transparent;
    }
  }

  .row.touched .ai {
    animation: dot-pop 700ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  @keyframes dot-pop {
    0% {
      transform: scale(0);
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-strong) 60%, transparent);
    }
    45% {
      transform: scale(1.5);
    }
    100% {
      transform: scale(1);
      box-shadow: 0 0 0 7px transparent;
    }
  }

  .row.new {
    animation: row-in 320ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  @keyframes row-in {
    from {
      opacity: 0;
      transform: translateX(-10px);
    }
  }

  .row.gone.touched .name {
    animation: strike 600ms ease-out 150ms both;
  }

  @keyframes strike {
    from {
      color: var(--text);
      text-decoration-color: transparent;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .row.touched::before,
    .row.accepted::before,
    .row.rejected::before,
    .row.restored .name,
    .row.touched .ai,
    .row.new,
    .row.gone.touched .name {
      animation: none;
    }
  }

  .create {
    padding: var(--space-1) var(--space-3) var(--space-1) 0;
  }

  .row-input {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-left: 17px;
  }

  .row-input input {
    flex: 1;
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--accent-strong);
    border-radius: var(--radius-sm);
    outline: none;
    font: inherit;
  }

  .error {
    margin: var(--space-1) 0 0 17px;
    color: var(--error);
    font-size: var(--font-xs);
    white-space: normal;
  }

  .row.drop-target,
  .tree.drop-target {
    background: var(--pressed);
    outline: 1px dashed var(--accent-strong);
    outline-offset: -1px;
  }

  .row.dragging {
    opacity: 0.5;
  }

  .rename {
    flex: 1;
    min-width: 0;
    padding: 0 var(--space-2);
    border: 1px solid var(--accent-strong);
    border-radius: var(--radius-sm);
    outline: none;
    font: inherit;
    font-weight: normal;
  }

  .menu {
    position: fixed;
    z-index: 10;
    display: flex;
    flex-direction: column;
    min-width: 200px;
    padding: var(--space-2) 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
    font-size: var(--font-md);
  }

  .menu button {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-5);
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
  }

  .menu button:hover {
    background: var(--hover);
  }

  .menu .danger {
    color: var(--error);
  }

  .menu kbd {
    margin-left: auto;
    color: var(--text-muted);
    font-family: inherit;
    font-size: var(--font-xs);
  }

  .menu-note {
    margin: 0;
    padding: var(--space-2) var(--space-5);
    color: var(--text-muted);
  }

  .menu hr {
    margin: var(--space-2) 0;
    border: none;
    border-top: 1px solid var(--border);
  }

  .hint {
    margin: var(--space-5);
    color: var(--text-muted);
    font-size: var(--font-sm);
  }
</style>
