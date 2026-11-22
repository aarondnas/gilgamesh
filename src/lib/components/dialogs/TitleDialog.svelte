<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import { errorMessage } from "$lib/api";
  import type { TitleData } from "$lib/latex/title";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { pageLayout } from "$lib/state/page-layout.svelte";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";

  /** `false` where the title cannot be set (no preamble). */
  let available = $state(false);
  let subtitleShown = $state(false);
  let title = $state("");
  let subtitle = $state("");
  let authors = $state<string[]>([]);
  /** The name being typed, not yet among `authors`. */
  let author = $state("");
  let dateKind = $state<"today" | "own" | "none">("today");
  let date = $state("");
  let make = $state(true);
  let ownPage = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function show() {
    error = null;
    busy = false;
    try {
      const state = await pageLayout.titleState();
      available = !!state;
      if (!state) return;
      const { data } = state;
      subtitleShown = state.subtitle;
      title = data.title;
      subtitle = data.subtitle;
      authors = [...data.authors];
      author = "";
      dateKind = data.date === null ? "today" : data.date === "" ? "none" : "own";
      date = data.date ?? "";
      // A document with a title page of its own (the thesis template's) sets it so already.
      make = state.sets || !data.title;
      ownPage = state.ownPage;
    } catch (err) {
      available = false;
      error = errorMessage(err);
    }
  }

  /** Adds the typed name as a tag below the field. */
  function addAuthor() {
    const name = author.trim();
    if (name) authors = [...authors, name];
    author = "";
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !available) return;
    // A name typed but not added yet counts too.
    addAuthor();
    busy = true;
    error = null;
    const data: TitleData = {
      title: title.trim(),
      subtitle: subtitle.trim(),
      authors,
      date: dateKind === "today" ? null : dateKind === "none" ? "" : date.trim(),
    };
    try {
      await pageLayout.setTitle(data, make, ownPage);
      doc.titleDialog = false;
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog open={doc.titleDialog} width={520} onopen={show} onclose={() => (doc.titleDialog = false)}>
  <form onsubmit={submit}>
    <h1>{m.title_dialog_title()}</h1>

    {#if available}
      <label class="field title">
        <span>{m.title_title()}</span>
        <input bind:value={title} disabled={busy} />
      </label>
      <!-- Side by side where they fit, else one below the other. -->
      <div class="checks">
        <label class="check"><input type="checkbox" bind:checked={make} disabled={busy} /> {m.title_make()}</label>
        <label class="check" class:off={!make}
          ><input type="checkbox" bind:checked={ownPage} disabled={busy || !make} /> {m.title_own_page()}</label
        >
      </div>
      {#if subtitleShown}
        <label class="field">
          <span>{m.title_subtitle()}</span>
          <input bind:value={subtitle} disabled={busy} />
        </label>
      {/if}
      <div class="field">
        <label for="title-author">{m.title_authors()}</label>
        <div class="add">
          <input
            id="title-author"
            bind:value={author}
            placeholder={m.title_authors_hint()}
            disabled={busy}
            onkeydown={(e) => {
              if (e.key !== "Enter") return;
              // Enter adds the name, rather than sending the form.
              e.preventDefault();
              addAuthor();
            }}
          />
          <button
            type="button"
            class="plus"
            title={m.title_author_add()}
            aria-label={m.title_author_add()}
            disabled={busy || !author.trim()}
            onclick={addAuthor}
          >
            <Plus size={16} />
          </button>
        </div>
        {#if authors.length}
          <ul class="tags">
            {#each authors as name, i (i)}
              <li class="tag">
                {name}
                <button
                  type="button"
                  title={m.title_author_remove({ name })}
                  aria-label={m.title_author_remove({ name })}
                  disabled={busy}
                  onclick={() => (authors = authors.filter((_, k) => k !== i))}
                >
                  <X size={12} />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      <fieldset>
        <legend>{m.title_date()}</legend>
        <!-- At most one of the two; neither is no date. -->
        <label>
          <input
            type="checkbox"
            checked={dateKind === "today"}
            onchange={(e) => (dateKind = e.currentTarget.checked ? "today" : "none")}
            disabled={busy}
          />
          {m.title_date_today()}
        </label>
        <label class="own">
          <input
            type="checkbox"
            checked={dateKind === "own"}
            onchange={(e) => (dateKind = e.currentTarget.checked ? "own" : "none")}
            disabled={busy}
          />
          {m.title_date_own()}
          <input bind:value={date} disabled={busy || dateKind !== "own"} placeholder={m.title_date_example()} />
        </label>
      </fieldset>
      <p class="hint">{m.title_hint()}</p>
    {:else if !error}
      <p class="hint">{m.page_setup_no_document()}</p>
    {/if}

    {#if error}<p class="error">{error}</p>{/if}

    <footer>
      <Button onclick={() => (doc.titleDialog = false)} disabled={busy}>{m.new_project_cancel()}</Button>
      <Button type="submit" variant="primary" disabled={busy || !available}>{m.page_numbers_submit()}</Button>
    </footer>
  </form>
</Dialog>

<style>
  /* The name and the button to add it, side by side. */
  .add {
    display: flex;
    gap: var(--space-2);
  }

  .add input {
    flex: 1;
    min-width: 0;
  }

  .plus {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--accent-strong);
  }

  .plus:hover:not(:disabled) {
    background: var(--hover);
  }

  .plus:disabled {
    opacity: 0.45;
  }

  /* The authors added, as tags to remove with their ×. */
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-1) 0 0;
    padding: 0;
    list-style: none;
  }

  .tag {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-4);
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--hover);
    font-size: var(--font-sm);
    font-weight: normal;
  }

  .tag button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
  }

  .tag button:hover:not(:disabled) {
    background: var(--pressed);
    color: var(--text);
  }

  fieldset {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0 0 var(--space-5);
    padding: 0;
    border: none;
    font-size: var(--font-sm);
  }

  legend {
    margin-bottom: var(--space-2);
    padding: 0;
    font-weight: 600;
  }

  fieldset label {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .own input:not([type="checkbox"]) {
    flex: 1;
    padding: var(--space-1) var(--space-3);
  }

  /* The title's options, close below it. */
  .field.title {
    margin-bottom: var(--space-3);
  }

  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-6);
    margin-bottom: var(--space-5);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--font-sm);
  }

  /* Its option with no effect, as long as the other is off. */
  .check.off {
    opacity: 0.45;
  }
</style>
