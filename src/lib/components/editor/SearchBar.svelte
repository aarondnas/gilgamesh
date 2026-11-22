<script lang="ts">
  import { onMount } from "svelte";
  import { closeSearchPanel } from "@codemirror/search";
  import { runScopeHandlers, type EditorView, type ViewUpdate } from "@codemirror/view";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import X from "@lucide/svelte/icons/x";
  import { m } from "$lib/paraglide/messages";
  import { projectSearch as search } from "$lib/state/search.svelte";
  import Button from "../ui/Button.svelte";

  interface Props {
    /** The editor whose bar this is. */
    view: EditorView;
    /** The file it shows, for where in the project's hits it is. */
    file: () => string | null;
  }

  let { view, file }: Props = $props();

  let input: HTMLInputElement;
  /** The editor's selection, kept by `update`; the bar lives with one view, whose start is read once. */
  // svelte-ignore state_referenced_locally
  let selection = $state({ from: view.state.selection.main.from, to: view.state.selection.main.to });
  let busy = $state(false);

  /** From the editor (see `editor.svelte.ts`): the selection moved, the text changed. */
  export function update(update: ViewUpdate) {
    if (update.selectionSet || update.docChanged) {
      const { from, to } = update.state.selection.main;
      selection = { from, to };
    }
    // The hits' places moved; other files' hits stay where they were.
    if (update.docChanged) search.schedule();
  }

  const index = $derived(search.indexOf(file(), selection.from, selection.to));
  const count = $derived(
    !search.query || search.error
      ? ""
      : search.hits.length === 0
        ? m.cm_no_matches()
        : `${index >= 0 ? index + 1 : "–"}/${search.hits.length}${search.capped ? "+" : ""}`,
  );

  // A changed query or option: search again, light up the shown file's hits. In a microtask,
  // as the bar is made during an update of the editor, which takes no other update then.
  $effect(() => {
    void search.options;
    search.notice = null;
    search.schedule();
    queueMicrotask(() => search.highlight(view));
  });

  onMount(() =>
    search.register(view, () => {
      input.focus();
      input.select();
    }),
  );

  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    try {
      await action();
    } finally {
      busy = false;
    }
  }

  const step = (back: boolean) => run(() => search.step(file(), selection.from, selection.to, back));

  /** Escape, F3, Ctrl+G and Ctrl+F as in the editor (see `latex-editor.ts`). */
  function onKeyDown(event: KeyboardEvent) {
    if (runScopeHandlers(view, event, "search-panel")) {
      event.preventDefault();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (event.target === input) void step(event.shiftKey);
    else void run(() => search.replace(file(), selection.from, selection.to));
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="bar" role="search" onkeydown={onKeyDown}>
  <div class="row">
    <input
      bind:this={input}
      bind:value={search.query}
      class="field"
      class:invalid={!!search.error}
      placeholder={m.cm_find()}
      aria-label={m.cm_find()}
      title={search.error ?? undefined}
    />
    <span
      class="count"
      aria-live="polite"
      title={search.hits.length ? m.search_summary({ count: search.hits.length, files: search.files }) : undefined}
    >
      {count}
    </span>
    <Button class="square" title={m.cm_next()} aria-label={m.cm_next()} disabled={!search.hits.length} onclick={() => step(false)}>
      <ArrowDown size={14} />
    </Button>
    <Button class="square" title={m.cm_previous()} aria-label={m.cm_previous()} disabled={!search.hits.length} onclick={() => step(true)}>
      <ArrowUp size={14} />
    </Button>
    <label><input type="checkbox" bind:checked={search.caseSensitive} />{m.cm_match_case()}</label>
    <!-- The short word everyone knows; the full term as tooltip. -->
    <label title={m.search_regex()}><input type="checkbox" bind:checked={search.regex} />{m.cm_regexp()}</label>
    <label><input type="checkbox" bind:checked={search.wholeWord} />{m.cm_by_word()}</label>
  </div>
  <div class="row">
    <input bind:value={search.replacement} class="field" placeholder={m.cm_replace_placeholder()} aria-label={m.cm_replace_placeholder()} />
    <Button disabled={busy || !search.hits.length} onclick={() => run(() => search.replace(file(), selection.from, selection.to))}>
      {m.cm_replace()}
    </Button>
    <Button disabled={busy || !search.hits.length} onclick={() => run(() => search.replaceAll())}>{m.cm_replace_all()}</Button>
    {#if search.notice}<span class="notice">{search.notice}</span>{/if}
  </div>
  <button class="close" title={m.cm_close()} aria-label={m.cm_close()} onclick={() => closeSearchPanel(view)}>
    <X size={14} />
  </button>
</div>

<style>
  .bar {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-8) var(--space-3) var(--space-5);
    font-family: var(--font-ui);
    font-size: var(--font-sm);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  .field {
    width: 220px;
    height: 24px;
    box-sizing: border-box;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: var(--cursor-text) !important;
  }

  .field.invalid {
    border-color: var(--error);
  }

  .row :global(.btn) {
    height: 24px;
    box-sizing: border-box;
  }

  .row :global(.btn.square) {
    width: 24px;
    padding: 0;
  }

  /* Wide enough for "999/999", so the buttons do not move while stepping. */
  .count {
    min-width: 4.5em;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    white-space: nowrap;
  }

  label input {
    margin: 0;
  }

  .notice {
    color: var(--text-muted);
  }

  /* The cross, as on the app's tabs and dialogs. */
  .close {
    position: absolute;
    top: var(--space-3);
    right: var(--space-4);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
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
