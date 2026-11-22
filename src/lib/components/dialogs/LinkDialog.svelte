<script lang="ts">
  import { errorMessage } from "$lib/api";
  import { isUrl, REFERENCE_STYLES, type LinkTarget, type ReferenceStyle, type TargetKind } from "$lib/latex/links";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { inserting } from "$lib/state/inserting.svelte";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";

  let dialog = $state<HTMLDialogElement>();
  /** Kept while the dialog closes, so its content does not switch away. */
  let mode = $state<"web" | "reference">("web");
  let url = $state("");
  let text = $state("");
  /** The text follows the chosen target until the user types one of their own. */
  let textTouched = $state(false);
  let filter = $state("");
  let targets = $state.raw<LinkTarget[] | null>(null);
  let chosen = $state<LinkTarget | null>(null);
  let style = $state<ReferenceStyle>("named");
  let error = $state<string | null>(null);
  let busy = $state(false);

  const kindNames: Record<TargetKind, () => string> = {
    heading: m.link_kind_heading,
    figure: m.link_kind_figure,
    table: m.link_kind_table,
    equation: m.link_kind_equation,
    other: m.link_kind_other,
  };

  const shown = $derived.by(() => {
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (targets ?? []).filter((t) => {
      const haystack = `${t.number ?? ""} ${t.title} ${t.key ?? ""} ${kindNames[t.kind]()}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  });

  /** Starred headings have no number: `\ref` would give the one of the heading around them. */
  const styleUsable = (s: ReferenceStyle) => !chosen || chosen.numbered || (s !== "named" && s !== "number");

  const styleNames = $derived.by((): Record<ReferenceStyle, string> => {
    const number = chosen?.number ?? "2.1";
    return {
      named: m.link_style_named({ example: `${chosen ? kindNames[chosen.kind]() : m.link_kind_heading()} ${number}` }),
      number: m.link_style_number({ example: number }),
      title: m.link_style_title({ example: chosen?.title ?? m.link_example_title() }),
      page: m.link_style_page(),
      text: m.link_style_text(),
    };
  });

  const ready = $derived(mode === "web" ? isUrl(url) : chosen !== null && styleUsable(style) && (style !== "text" || text.trim() !== ""));

  function show() {
    mode = doc.linkDialog ?? "web";
    const selection = doc.selectedText().trim();
    text = selection;
    textTouched = selection !== "";
    url = isUrl(selection) ? selection : "";
    if (url) text = "";
    filter = "";
    chosen = null;
    style = selection ? "text" : "named";
    error = null;
    targets = null;
    if (mode === "reference") void loadTargets();
  }

  async function loadTargets() {
    try {
      const found = await inserting.linkTargets();
      if (doc.linkDialog) targets = found;
    } catch (err) {
      targets = [];
      error = errorMessage(err);
    }
  }

  function choose(target: LinkTarget) {
    chosen = target;
    if (!styleUsable(style)) style = "title";
    if (!textTouched) text = target.title;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    busy = true;
    error = null;
    try {
      if (mode === "web") await inserting.insertWebLink(url, text);
      else await inserting.insertReference(chosen!, style, text);
      doc.linkDialog = null;
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:dialog open={!!doc.linkDialog} width={540} onopen={show} onclose={() => (doc.linkDialog = null)}>
  <form onsubmit={submit}>
    <h1>{mode === "web" ? m.link_dialog_title() : m.link_reference_dialog_title()}</h1>

    {#if mode === "web"}
      <label class="field">
        <span>{m.link_url()}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={url} placeholder="https://…" autofocus spellcheck="false" disabled={busy} />
      </label>
      <label class="field">
        <span>{m.link_text()}</span>
        <input bind:value={text} placeholder={m.link_text_placeholder()} disabled={busy} />
      </label>
      <p class="hint">{m.link_web_hint()}</p>
    {:else}
      <label class="field">
        <span>{m.link_target()}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={filter} placeholder={m.link_filter()} autofocus disabled={busy} />
      </label>
      <div class="targets" role="listbox" aria-label={m.link_target()}>
        {#if targets === null}
          <p class="empty">{m.link_loading()}</p>
        {:else if !shown.length}
          <p class="empty">{targets.length ? m.link_no_match() : m.link_none()}</p>
        {:else}
          {#each shown as target (`${target.file}:${target.line}:${target.key}`)}
            <button
              type="button"
              role="option"
              aria-selected={chosen === target}
              class:selected={chosen === target}
              style:padding-left={target.kind === "heading" ? `calc(var(--space-4) + ${target.level * 12}px)` : undefined}
              onclick={() => choose(target)}
              ondblclick={() => {
                choose(target);
                dialog?.querySelector("form")?.requestSubmit();
              }}
              disabled={busy}
            >
              {#if target.kind !== "heading"}<span class="kind">{kindNames[target.kind]()}</span>{/if}
              {#if target.number}<span class="number">{target.number}</span>{/if}
              <span class="title">{target.title}</span>
              {#if target.key && target.title !== target.key}<span class="key">{target.key}</span>{/if}
            </button>
          {/each}
        {/if}
      </div>

      <label class="field">
        <span>{m.link_style()}</span>
        <select bind:value={style} disabled={busy}>
          {#each REFERENCE_STYLES as s (s)}
            <option value={s} disabled={!styleUsable(s)}>{styleNames[s]}</option>
          {/each}
        </select>
      </label>
      {#if style === "text"}
        <label class="field">
          <span>{m.link_text()}</span>
          <input bind:value={text} oninput={() => (textTouched = true)} disabled={busy} />
        </label>
      {/if}
      {#if chosen && chosen.key === null}
        <p class="hint">{m.link_new_label({ label: chosen.newLabel ?? "", file: chosen.file })}</p>
      {/if}
    {/if}

    {#if error}<p class="error">{error}</p>{/if}

    <footer>
      <Button onclick={() => (doc.linkDialog = null)} disabled={busy}>{m.new_project_cancel()}</Button>
      <Button type="submit" variant="primary" disabled={busy || !ready}>{m.link_submit()}</Button>
    </footer>
  </form>
</Dialog>

<style>
  .targets {
    display: flex;
    flex-direction: column;
    height: 240px;
    margin: calc(-1 * var(--space-3)) 0 var(--space-5);
    padding: var(--space-1);
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .targets button {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--font-sm);
    text-align: left;
  }

  .targets button:hover {
    background: var(--surface-2);
  }

  .targets button.selected {
    background: var(--accent);
    color: var(--on-accent);
  }

  .kind,
  .key {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: var(--font-xs);
  }

  .selected .kind,
  .selected .key {
    color: var(--on-accent-muted);
  }

  .number {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    margin: auto;
    color: var(--text-muted);
    font-size: var(--font-sm);
  }
</style>
