<script lang="ts">
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { errorMessage } from "$lib/api";
  import type { Lang } from "$lib/config/template-texts";
  import {
    POSITIONS,
    sameCounting,
    STYLES,
    styleExample,
    type Counting,
    type FieldContent,
    type HeaderFooter,
    type NumberPosition,
  } from "$lib/latex/page-numbers";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { pageLayout } from "$lib/state/page-layout.svelte";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";
  import PageCounting, { choiceOf, countingOf, validChoices, type Choice, type Region } from "./PageCounting.svelte";

  type Info = { setup: HeaderFooter; twoSided: boolean; lang: Lang; chapters: boolean; title: string; author: string };

  /** `null` where the header and footer cannot be set (beamer, no preamble). */
  let info = $state<Info | null>(null);
  let setup = $state<HeaderFooter>({ fields: {}, style: "number", small: false, rule: false });
  let error = $state<string | null>(null);
  let busy = $state(false);
  /** Whether the page number options are open: how the number reads and how it counts. */
  let numbersOpen = $state(false);
  /** The regions of the body, read when the page number options first open (SyncTeX takes a moment); `null` until then. */
  let regions = $state<Region[] | null>(null);
  /** How each region counts, by its place in `regions`. */
  let choices = $state<Choice[]>([]);
  let regionsError = $state<string | null>(null);
  /** Fields set to a text of the user's own in this dialog, even one that reads like the title or author. */
  let custom = $state<Partial<Record<NumberPosition, boolean>>>({});

  const positions = $derived(POSITIONS[info?.twoSided ? "twoSided" : "oneSided"]);
  const columnNames = $derived(
    info?.twoSided
      ? [m.header_footer_outer(), m.header_footer_center(), m.header_footer_inner()]
      : [m.header_footer_left(), m.header_footer_center(), m.header_footer_right()],
  );
  const hasNumber = $derived(Object.values(setup.fields).some((f) => f?.kind === "page"));
  const valid = $derived(validChoices(choices));

  async function show() {
    error = null;
    busy = false;
    regions = null;
    choices = [];
    regionsError = null;
    numbersOpen = false;
    custom = {};
    try {
      info = await pageLayout.headerFooterState();
    } catch (err) {
      info = null;
      error = errorMessage(err);
    }
    if (info) setup = structuredClone($state.snapshot(info.setup));
  }

  async function loadRegions() {
    if (regions || regionsError) return;
    try {
      const state = await pageLayout.pageNumberState();
      if (!doc.headerFooterDialog) return;
      regions = state ?? [];
      choices = regions.map((r) => choiceOf(r.counting));
    } catch (err) {
      regionsError = errorMessage(err);
    }
  }

  function toggleNumbers() {
    numbersOpen = !numbersOpen;
    if (numbersOpen) void loadRegions();
  }

  /** The list's entry for a field: a text is the title or author where it reads like it, else a text of the user's own. */
  function kindOf(position: NumberPosition): string {
    const content = setup.fields[position];
    if (content?.kind !== "text") return content?.kind ?? "none";
    if (custom[position]) return "text";
    if (info?.title && content.text === info.title) return "title";
    if (info?.author && content.text === info.author) return "author";
    return "text";
  }

  function choose(position: NumberPosition, value: string) {
    let content: FieldContent;
    if (value === "title") content = { kind: "text", text: info?.title ?? "" };
    else if (value === "author") content = { kind: "text", text: info?.author ?? "" };
    else if (value === "text") content = { kind: "text", text: "" };
    else content = { kind: value } as FieldContent;
    setup.fields = { ...setup.fields, [position]: content };
    custom = { ...custom, [position]: value === "text" };
  }

  function setText(position: NumberPosition, text: string) {
    setup.fields = { ...setup.fields, [position]: { kind: "text", text } };
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !info || !valid) return;
    const changed = new Map<number, Counting>();
    regions?.forEach((region, i) => {
      const wanted = countingOf($state.snapshot(choices[i]));
      if (!sameCounting(region.counting, wanted)) changed.set(i, wanted);
    });
    busy = true;
    error = null;
    try {
      await pageLayout.setHeaderFooter($state.snapshot(setup), changed);
      doc.headerFooterDialog = false;
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog open={doc.headerFooterDialog} width={760} onopen={show} onclose={() => (doc.headerFooterDialog = false)}>
  <form onsubmit={submit}>
    <h1>{m.header_footer_title()}</h1>

    {#if info}
      <!-- The page itself: what each field shows, where it stands. -->
      <div class="page">
        {#each [positions.slice(0, 3), positions.slice(3)] as row, r (r)}
          {#if r === 1}
            <div class="body" aria-hidden="true">
              {#each { length: 7 } as _, i (i)}<span class="line" class:short={i === 6}></span>{/each}
            </div>
          {/if}
          <div class="row" class:header={r === 0} class:rule={r === 0 && setup.rule}>
            {#each row as position, i (position)}
              {@const own = kindOf(position) === "text"}
              <div class="cell" style:text-align={["left", "center", "right"][i]}>
                <span class="column">{r === 0 ? m.header_footer_header() : m.header_footer_footer()} · {columnNames[i]}</span>
                <!-- The list, and beside it, each half the width, the text of the user's own where that is chosen. -->
                <span class="pick" class:own>
                  <select value={kindOf(position)} disabled={busy} onchange={(e) => choose(position, e.currentTarget.value)}>
                    <option value="none">{m.header_footer_none()}</option>
                    <option value="page">{m.header_footer_page()}</option>
                    <option value="chapter">{info.chapters ? m.header_footer_chapter() : m.header_footer_section()}</option>
                    <option value="section">{info.chapters ? m.header_footer_section() : m.header_footer_subsection()}</option>
                    {#if info.title}<option value="title">{m.header_footer_doc_title()}</option>{/if}
                    {#if info.author}<option value="author">{m.header_footer_doc_author()}</option>{/if}
                    <option value="text">{m.header_footer_text()}</option>
                  </select>
                  {#if own}
                    {@const content = setup.fields[position]}
                    <span class="slot">
                      <input
                        value={content?.kind === "text" ? content.text : ""}
                        oninput={(e) => setText(position, e.currentTarget.value)}
                        placeholder={m.header_footer_text_placeholder()}
                        disabled={busy}
                      />
                    </span>
                  {/if}
                </span>
              </div>
            {/each}
          </div>
        {/each}
      </div>

      <div class="options">
        <label class="check"><input type="checkbox" bind:checked={setup.small} disabled={busy} /> {m.header_footer_small()}</label>
        <label class="check"><input type="checkbox" bind:checked={setup.rule} disabled={busy} /> {m.header_footer_rule()}</label>
      </div>

      {#if hasNumber}
        <!-- Everything about the page number, wherever it stands: how it reads and how it counts. -->
        <Button class="numbers-toggle" aria-expanded={numbersOpen} onclick={toggleNumbers} disabled={busy}>
          {m.header_footer_number_options()}
          <ChevronDown size={14} class={numbersOpen ? "open" : ""} />
        </Button>
        {#if numbersOpen}
          <section class="numbers">
            <label class="field">
              <span>{m.page_numbers_style()}</span>
              <select bind:value={setup.style} disabled={busy}>
                {#each STYLES as s (s)}<option value={s}>{styleExample(s, info.lang)}</option>{/each}
              </select>
            </label>
            {#if regions}
              <PageCounting {regions} {choices} {busy} />
            {:else if regionsError}
              <p class="error">{regionsError}</p>
            {:else}
              <p class="hint">{m.header_footer_number_loading()}</p>
            {/if}
          </section>
        {/if}
      {/if}
      <p class="hint">{m.header_footer_hint()}</p>
    {:else if !error}
      <p class="hint">{m.page_setup_no_document()}</p>
    {/if}

    {#if error}<p class="error">{error}</p>{/if}

    <footer>
      <Button onclick={() => (doc.headerFooterDialog = false)} disabled={busy}>{m.new_project_cancel()}</Button>
      <Button type="submit" variant="primary" disabled={busy || !info || !valid}>{m.page_numbers_submit()}</Button>
    </footer>
  </form>
</Dialog>

<style>
  /* A sheet of paper: light in the dark theme too, its fields with it (the light theme's values). */
  .page {
    color-scheme: light;
    --surface: #ffffff;
    --text: #1f1f1f;
    --text-muted: #616161;
    --border: #d6d6d3;
    --hover: #f0f0ef;
    --accent-strong: #20201f;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5) var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: #fff;
    color: #1f2328;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
  }

  .row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-4);
    padding-bottom: var(--space-3);
    border-bottom: 1px dashed transparent;
  }

  .row.header.rule {
    border-bottom: 1px solid #1f2328;
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .cell select,
  .cell input {
    width: 100%;
    min-width: 0;
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-sm);
  }

  /* List and text in one frame: the list's right edge is the line between them. */
  .pick {
    display: grid;
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .pick.own {
    grid-template-columns: 1fr 1fr;
  }

  .pick.own select {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  /*
   * The open list drawn by the page, not the system: the system's is as wide
   * as its longest entry and leaves no room after it. Where the browser cannot
   * (WebKit), the system's list stays.
   */
  @supports (appearance: base-select) {
    .pick select,
    .pick select::picker(select) {
      appearance: base-select;
    }

    .pick select {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      overflow: hidden;
      white-space: nowrap;
    }

    .pick select::picker-icon {
      color: var(--text-muted);
      font-size: 9px;
    }

    .pick select::picker(select) {
      padding: var(--space-2) 0;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
      color: var(--text);
      box-shadow: 0 4px 12px rgb(0 0 0 / 0.15);
    }

    .pick option {
      padding: var(--space-2) var(--space-5);
      font-size: var(--font-sm);
      white-space: nowrap;
    }

    .pick option:hover,
    .pick option:focus-visible {
      outline: none;
      background: var(--hover);
    }

    .pick option:checked {
      font-weight: 600;
    }

    .pick option::checkmark {
      display: none;
    }
  }

  /* The focus ring over the text beside it, not behind it. */
  .pick select:focus,
  .slot:focus-within {
    position: relative;
    z-index: 1;
  }

  .slot {
    display: block;
    min-width: 0;
    border: 1px solid var(--border);
    border-left: none;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    background: var(--surface);
  }

  /* The frame is the slot's; the text cut short with … where it is longer than the line. */
  .cell input {
    height: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: none;
    background: transparent;
    color: inherit;
    font-family: inherit;
    text-align: left;
  }

  .cell input:focus-visible {
    outline: none;
  }

  .slot:focus-within {
    outline: 2px solid var(--accent-strong);
    outline-offset: 1px;
  }

  .column {
    color: #6b7280;
    font-size: var(--font-xs);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: var(--space-3) 0;
  }

  .line {
    height: 2px;
    border-radius: 1px;
    background: #d5d9de;
  }

  .line.short {
    width: 60%;
  }

  :global(.numbers-toggle) :global(.open) {
    transform: rotate(180deg);
  }

  .numbers {
    margin-top: var(--space-3);
    padding: var(--space-4) var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .numbers .field {
    max-width: 280px;
    margin-bottom: 0;
  }

  .numbers > .hint {
    margin: var(--space-3) 0 0;
  }

  .options {
    display: flex;
    align-items: flex-end;
    gap: var(--space-6);
    margin-top: var(--space-5);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-bottom: var(--space-3);
    font-size: var(--font-sm);
  }

  .hint {
    margin: var(--space-4) 0 0;
  }
</style>
