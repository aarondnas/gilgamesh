<!--
  A new list, in a dialog of its own over the lists dialog: kind, heading,
  file, place and contents entry. Once it is in, the lists dialog shows it.
-->
<script lang="ts">
  import { errorMessage } from "$lib/api";
  import { fileNameFor, LIST_KINDS, type ListKind } from "$lib/latex/lists";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { inserting } from "$lib/state/inserting.svelte";
  import { project } from "$lib/state/project.svelte";
  import { parentDir, treeFolders } from "$lib/util/paths";
  import { listNames } from "./list-names";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";
  import ListPlacePicker, { type ListDialogContext } from "./ListPlacePicker.svelte";

  interface Props {
    open: boolean;
    /** The kind it starts with. */
    initialKind: ListKind;
    onclose: () => void;
    /** After the list went in, with the file that prints it. */
    oninserted: (file: string) => void;
  }

  let { open, initialKind, onclose, oninserted }: Props = $props();

  let kind = $state<ListKind>(LIST_KINDS[0]);
  let heading = $state("");
  let name = $state("");
  /** The file name follows the heading until the user types one of their own. */
  let nameTouched = $state(false);
  let folder = $state("");
  /** Places, suggestion and table of contents choice for this kind; `null` until first read. */
  let context = $state<ListDialogContext | null>(null);
  /** While the context is read; what was shown stays meanwhile. */
  let loading = $state(true);
  /** Counts the reads, so one for a kind left meanwhile is dropped. */
  let reads = 0;
  let at = $state(0);
  let toc = $state(true);
  let error = $state<string | null>(null);
  let busy = $state(false);

  /** "" is the project folder itself. */
  const folders = $derived(treeFolders(project.tree));
  const ready = $derived(!!context && !loading && !!name.trim() && !!heading.trim());

  /** Starts afresh with `initialKind`; the dialog shows once its places are read. */
  async function show() {
    busy = false;
    nameTouched = false;
    folder = parentDir(project.config.main ?? "");
    await choose(initialKind);
  }

  /** Switches to `next`, its heading and file name with it, all at once once its places are read. */
  async function choose(next: ListKind) {
    const number = ++reads;
    loading = true;
    let read: { context: ListDialogContext } | { error: string };
    try {
      read = { context: await inserting.listContext(next) };
    } catch (err) {
      read = { error: errorMessage(err) };
    }
    if (number !== reads) return;
    kind = next;
    heading = listNames[next].name();
    if (!nameTouched) name = fileNameFor(heading, next);
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
  }

  function headingInput() {
    if (!nameTouched) name = fileNameFor(heading, kind);
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !context || !ready) return;
    const { tocChoice, source } = context;
    busy = true;
    error = null;
    try {
      const file = await inserting.insertList(kind, { dir: folder, name, heading, at, toc: tocChoice && toc, source });
      oninserted(file);
    } catch (err) {
      error = errorMessage(err);
      // The main file changed meanwhile: its current places.
      if (err instanceof Error && err.message === m.lists_changed()) {
        const keep = { heading, name, nameTouched };
        await choose(kind);
        ({ heading, name, nameTouched } = keep);
        error = m.lists_changed();
      }
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {open} width={560} onopen={show} {onclose}>
  <form onsubmit={submit}>
    <h1>{m.lists_new_title()}</h1>

    <label class="field">
      <span>{m.lists_kind()}</span>
      <select value={kind} disabled={busy} onchange={(e) => void choose(e.currentTarget.value as ListKind)}>
        {#each LIST_KINDS as k (k)}
          <option value={k}>{listNames[k].name()}</option>
        {/each}
      </select>
    </label>

    <label class="field">
      <span>{m.lists_heading()}</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={heading} oninput={headingInput} autofocus disabled={busy} />
    </label>

    <label class="field">
      <span>{m.lists_file_name()}</span>
      <div class="name">
        <input bind:value={name} oninput={() => (nameTouched = true)} disabled={busy} />
        {#if !/\.[^.]+$/.test(name.trim())}<span class="extension">.tex</span>{/if}
      </div>
    </label>

    <label class="field">
      <span>{m.lists_folder()}</span>
      <select bind:value={folder} disabled={busy}>
        {#each folders as path (path)}
          <option value={path}>{path || m.lists_project_folder()}</option>
        {/each}
      </select>
    </label>

    <ListPlacePicker {context} bind:at label={heading.trim() || listNames[kind].name()} tag={m.lists_suggested_tag()} {busy} />

    <!-- Hidden rather than left out where there is no choice (the table of contents itself), so the dialog keeps its height. -->
    <label class="check" class:hidden={!context?.tocChoice} aria-hidden={!context?.tocChoice}>
      <input type="checkbox" bind:checked={toc} disabled={busy || !context?.tocChoice} />
      {m.lists_toc()}
    </label>

    {#if context?.exists}<p class="hint">{m.lists_exists()}</p>{/if}
    <p class="hint">{m.lists_hint({ main: project.config.main ?? "" })}</p>
    {#if error}<p class="error">{error}</p>{/if}

    <footer>
      <Button onclick={onclose} disabled={busy}>{m.new_project_cancel()}</Button>
      <Button type="submit" variant="primary" disabled={busy || !ready}>{m.lists_submit()}</Button>
    </footer>
  </form>
</Dialog>

<style>
  .name {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .name input {
    flex: 1;
    min-width: 0;
  }

  .extension {
    color: var(--text-muted);
    font-size: var(--font-base);
    font-weight: normal;
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
