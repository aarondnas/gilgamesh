<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import { errorMessage } from "$lib/api";
  import { LIST_KINDS, type ListKind, type PrintedList } from "$lib/latex/lists";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { inserting } from "$lib/state/inserting.svelte";
  import { project } from "$lib/state/project.svelte";
  import { listNames } from "./list-names";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";
  import ListPlacePicker, { type ListDialogContext } from "./ListPlacePicker.svelte";
  import NewListDialog from "./NewListDialog.svelte";

  /** The document's list a tab shows: its kind and the main file's line that holds it. */
  type Shown = { kind: ListKind; line: number };

  let heading = $state("");
  /** Places, suggestion and table of contents choice for the shown list; `null` until first read. */
  let context = $state<ListDialogContext | null>(null);
  /** While a tab's context is read; the tab before stays as it was meanwhile. */
  let loading = $state(true);
  /** Counts the reads, so one for a tab left meanwhile is dropped. */
  let reads = 0;
  let at = $state(0);
  let toc = $state(true);
  let error = $state<string | null>(null);
  let busy = $state(false);
  /** The heading as the list had it, to tell whether it was changed. */
  let headingBefore = "";
  /** Removing asks once more: the list's file goes to the recycle bin. */
  let confirmRemove = $state(false);
  /** Set once a change went through; the dialog stays open for more. */
  let applied = $state(false);
  /** The lists the document has, a tab each. */
  let lists = $state<PrintedList[]>([]);
  /** Whether the dialog for a new list is open over this one, and the kind it starts with. */
  let creating = $state(false);
  let newKind = $state<ListKind>(LIST_KINDS[0]);

  const kind = $derived(doc.listDialog?.kind ?? null);
  /** The main file's line of the list shown; `null` where the document has none. */
  const editLine = $derived(doc.listDialog?.line ?? null);
  const entry = $derived(context?.entry ?? null);

  /** For a new list: the first kind the document lacks. */
  const firstMissing = () => LIST_KINDS.find((k) => !lists.some((l) => l.kind === k)) ?? LIST_KINDS[0];

  /** Reads the document's lists anew and shows the one `match` finds, else the first. */
  async function refresh(match?: (list: PrintedList) => boolean) {
    lists = await inserting.printedLists();
    const found = (match && lists.find(match)) ?? lists[0];
    if (found) return select({ kind: found.kind, line: found.line });
    context = null;
    loading = false;
    if (doc.listDialog) doc.listDialog = { kind: null, line: null };
  }

  /**
   * Opened from the ribbon (no kind: the first list), for a given list, or for
   * a new one of a kind. A new one, and any where the document has none yet,
   * goes in through the dialog for it, over this one.
   */
  async function open() {
    const wanted = doc.listDialog;
    creating = false;
    applied = false;
    error = null;
    const kind = wanted?.kind;
    await refresh(kind && wanted.line !== null ? (l) => l.kind === kind && l.line === wanted.line : undefined);
    // Once this dialog shows, so the new one goes over it.
    if ((kind && wanted.line === null) || !lists.length) setTimeout(() => startNew(kind ?? undefined));
  }

  function startNew(kind?: ListKind) {
    newKind = kind ?? firstMissing();
    creating = true;
  }

  /**
   * Shows `next` once its context is read, all of it at once: until then the
   * tab before stays as it was, rather than a mix of both showing for a moment.
   */
  async function select(next: Shown) {
    const read = await readFor(next);
    // A later switch, or the dialog closed meanwhile.
    if (!read || !doc.listDialog) return;
    doc.listDialog = next;
    applied = false;
    heading = "";
    confirmRemove = false;
    apply(read);
  }

  /** Reads the shown tab's context anew, e.g. after the main file changed. */
  async function load(shown: Shown) {
    const read = await readFor(shown);
    if (read) apply(read);
  }

  type Read = { context: ListDialogContext } | { error: string };

  /** The context of `shown`; `null` where another read started meanwhile. */
  async function readFor(shown: Shown): Promise<Read | null> {
    const number = ++reads;
    loading = true;
    let read: Read;
    try {
      read = { context: await inserting.listEditContext(shown.kind, shown.line) };
    } catch (err) {
      read = { error: errorMessage(err) };
    }
    return number === reads ? read : null;
  }

  function apply(read: Read) {
    loading = false;
    if ("error" in read) {
      context = null;
      error = read.error;
      return;
    }
    error = null;
    context = read.context;
    at = read.context.suggested;
    toc = read.context.tocDefault;
    if (read.context.entry) heading = headingBefore = read.context.entry.heading ?? "";
  }

  /** An edited list keeps what is left empty. */
  const ready = $derived(!!context && !loading && editLine !== null);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !kind || !context || !ready || editLine === null) return;
    const listKind = kind;
    const line = editLine;
    const { tocChoice, tocDefault, source } = context;
    const file = entry?.file ?? null;
    await run(async () => {
      await inserting.editList(listKind, line, {
        at,
        heading: heading.trim() !== headingBefore ? heading : null,
        toc: tocChoice ? toc : tocDefault,
        source,
      });
      // The same list again, wherever it moved.
      return file ? (l) => l.file === file : (l) => l.kind === listKind && l.file === null;
    });
  }

  async function remove() {
    if (!confirmRemove) {
      confirmRemove = true;
      return;
    }
    if (busy || loading || !kind || !context || editLine === null) return;
    const listKind = kind;
    const line = editLine;
    const { source } = context;
    await run(async () => {
      await inserting.removeList(listKind, line, source);
      return undefined;
    });
  }

  /** The new list went in: its tab. */
  async function inserted(file: string) {
    creating = false;
    await run(async () => (l) => l.file === file);
  }

  /**
   * Runs the dialog's change and shows the lists as they are now, at the tab
   * the change returns a matcher for; where the main file changed meanwhile,
   * offers its current places.
   */
  async function run(change: () => Promise<((list: PrintedList) => boolean) | undefined>) {
    const shown = doc.listDialog;
    if (!shown) return;
    busy = true;
    error = null;
    try {
      const match = await change();
      await refresh(match);
      applied = true;
    } catch (err) {
      error = errorMessage(err);
      if (err instanceof Error && err.message === m.lists_changed() && shown.kind && shown.line !== null) {
        await load({ kind: shown.kind, line: shown.line });
        error = m.lists_changed();
      }
    } finally {
      busy = false;
      confirmRemove = false;
    }
  }
</script>

<Dialog
  open={!!doc.listDialog}
  width={560}
  onopen={open}
  onclose={() => {
    creating = false;
    doc.listDialog = null;
  }}
>
  <form onsubmit={submit}>
    <h1>{m.ribbon_group_lists()}</h1>

    <!-- A new list, in a dialog of its own over this one. -->
    <div class="new-row">
      <Button size="md" disabled={busy} onclick={() => startNew()}>
        <Plus size={16} />
        {m.lists_new_tab()}
      </Button>
    </div>

    {#if lists.length}
      <!-- The document's lists, a tab each. -->
      <div class="tabs" role="tablist" aria-label={m.ribbon_group_lists()}>
        {#each lists as list (list.line)}
          {@const Icon = listNames[list.kind].icon}
          <button
            type="button"
            role="tab"
            class:active={editLine === list.line}
            aria-selected={editLine === list.line}
            title={m.lists_line({ number: list.line })}
            disabled={busy}
            onclick={() => void select({ kind: list.kind, line: list.line })}
          >
            <Icon size={14} />
            {listNames[list.kind].name()}
            <!-- Several of a kind: the line tells them apart. -->
            {#if lists.filter((l) => l.kind === list.kind).length > 1}
              <span class="tab-line">{m.lists_line({ number: list.line })}</span>
            {/if}
          </button>
        {/each}
      </div>

      <label class="field">
        <span>{m.lists_heading()}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={heading} autofocus disabled={busy || !entry?.headingChoice} placeholder={m.lists_heading_default()} />
      </label>

      <!-- A list inside an environment or sharing its lines stays where it is. -->
      {#if !entry || entry.movable}
        <ListPlacePicker
          {context}
          bind:at
          label={heading.trim() || (kind ? listNames[kind].name() : "")}
          tag={m.lists_current_tag()}
          {busy}
        />
      {/if}

      <!-- Hidden rather than left out where there is no choice (the table of contents itself), so the dialog keeps its height. -->
      <label class="check" class:hidden={!context?.tocChoice} aria-hidden={!context?.tocChoice}>
        <input type="checkbox" bind:checked={toc} disabled={busy || !context?.tocChoice} />
        {m.lists_toc()}
      </label>

      {#if entry}
        <p class="hint">
          {entry.file
            ? m.lists_edit_file({ file: entry.file, main: project.config.main ?? "", line: entry.line })
            : m.lists_edit_main({ main: project.config.main ?? "", line: entry.line })}
        </p>
      {/if}
    {:else}
      <p class="hint">{m.lists_none()}</p>
    {/if}
    {#if applied}<p class="hint applied">{m.lists_applied()}</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}

    <footer>
      {#if editLine !== null && entry?.movable}
        <Button class="remove" onclick={remove} disabled={busy}>
          {confirmRemove ? m.lists_remove_confirm() : m.lists_remove()}
        </Button>
      {/if}
      <Button onclick={() => (doc.listDialog = null)} disabled={busy}>{m.lists_close()}</Button>
      {#if lists.length}
        <Button type="submit" variant="primary" disabled={busy || !ready}>{m.lists_apply()}</Button>
      {/if}
    </footer>
  </form>
</Dialog>

<NewListDialog open={creating && !!doc.listDialog} initialKind={newKind} onclose={() => (creating = false)} oninserted={inserted} />

<style>
  /* Apart from the buttons that close the dialog. */
  footer :global(.remove) {
    margin-right: auto;
  }

  .new-row {
    display: flex;
    margin-bottom: var(--space-4);
  }

  /* The document's lists, in one row that scrolls sideways where they do not fit, with a thin scrollbar a little below them. */
  .tabs {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-5);
    padding-bottom: var(--space-3);
    overflow-x: auto;
    overflow-y: hidden;
  }

  .tabs::-webkit-scrollbar {
    height: 4px;
  }

  .tabs::-webkit-scrollbar-thumb {
    border-radius: 2px;
    background: var(--border);
  }

  .tabs::-webkit-scrollbar-thumb:hover {
    background: var(--text-muted);
  }

  .tabs::-webkit-scrollbar-track {
    background: transparent;
  }

  .tabs button {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--text-muted);
    font: inherit;
    white-space: nowrap;
    transition: color 150ms ease;
  }

  .tabs button:hover:not(:disabled) {
    color: var(--text);
  }

  .tabs button.active {
    border-bottom-color: var(--accent-strong);
    color: var(--accent-strong);
    font-weight: 600;
  }

  .tab-line {
    font-size: var(--font-xs);
    font-weight: normal;
  }

  .applied {
    color: var(--accent-strong);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
    font-size: var(--font-base);
  }

  .check.hidden {
    visibility: hidden;
  }

  .check input {
    margin: 0;
    padding: 0;
    accent-color: var(--accent-strong);
  }
</style>
