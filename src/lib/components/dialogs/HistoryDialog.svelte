<script lang="ts">
  import { api, errorMessage, type Version } from "$lib/api";
  import { m } from "$lib/paraglide/messages";
  import { getLocale } from "$lib/paraglide/runtime";
  import { doc } from "$lib/state/document.svelte";
  import { project } from "$lib/state/project.svelte";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";

  let versions = $state<Version[]>([]);
  let selected = $state<number | null>(null);
  let preview = $state("");
  let error = $state<string | null>(null);

  const format = $derived(new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "short" }));

  /** Shows the dialog right away; the versions come in while it is open. */
  function show(file: string) {
    error = null;
    preview = "";
    selected = null;
    versions = [];
    void load(file);
  }

  async function load(file: string) {
    try {
      versions = await api.historyList(project.root!, file);
      if (versions.length > 0) await select(versions[0].timestamp);
    } catch (err) {
      error = errorMessage(err);
    }
  }

  async function select(timestamp: number) {
    selected = timestamp;
    try {
      preview = await api.historyRead(project.root!, doc.historyFor!, timestamp);
    } catch (err) {
      error = errorMessage(err);
    }
  }
</script>

<Dialog open={!!doc.historyFor} width={900} onopen={() => show(doc.historyFor!)} onclose={() => (doc.historyFor = null)} class="history">
  <h1>{m.history_title({ file: doc.historyFor ?? "" })}</h1>
  <p class="hint">{m.history_hint()}</p>

  {#if versions.length === 0}
    <p class="empty">{error ?? m.history_empty()}</p>
  {:else}
    <div class="body">
      <ul>
        {#each versions as version, i (version.timestamp)}
          <li>
            <button class:active={selected === version.timestamp} onclick={() => select(version.timestamp)}>
              <strong>{format.format(version.timestamp)}</strong>
              {#if i === 0}<span>{m.history_latest()}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
      <pre>{preview}</pre>
    </div>
    {#if error}<p class="error">{error}</p>{/if}
  {/if}

  <footer>
    <Button onclick={() => (doc.historyFor = null)}>{m.history_close()}</Button>
    <Button
      variant="primary"
      disabled={selected === null}
      onclick={() => selected !== null && doc.historyFor && doc.restoreVersion(doc.historyFor, selected)}
    >
      {m.history_restore()}
    </Button>
  </footer>
</Dialog>

<style>
  :global(dialog.history) {
    height: min(640px, 100% - 2 * var(--space-6));
  }

  :global(dialog.history[open]) {
    display: flex;
    flex-direction: column;
  }

  h1 {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-lg);
    font-weight: 600;
  }

  .hint {
    margin: var(--space-3) 0 var(--space-5);
    color: var(--text-muted);
    font-size: var(--font-sm);
  }

  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: var(--space-5);
  }

  ul {
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
    border-right: 1px solid var(--border);
  }

  li button {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--font-sm);
    text-align: left;
  }

  li button:hover {
    background: var(--hover);
  }

  li button.active {
    background: var(--pressed);
  }

  li span {
    color: var(--accent-strong);
    font-size: var(--font-xs);
  }

  pre {
    margin: 0;
    padding: var(--space-4);
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: var(--font-sm);
    white-space: pre-wrap;
  }

  .empty {
    flex: 1;
    color: var(--text-muted);
  }

  .error {
    color: var(--error);
    font-size: var(--font-sm);
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-top: var(--space-5);
  }
</style>
