<script lang="ts">
  import { errorMessage, type ProjectScan } from "$lib/api";
  import {
    citeCode,
    citeForms,
    entryKey,
    entryType,
    formatEntry,
    parseEntry,
    SOURCE_KINDS,
    STYLES,
    type BibEntry,
    type BibSetup,
    type CiteForm,
    type SourceKind,
  } from "$lib/latex/citations";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { inserting } from "$lib/state/inserting.svelte";
  import { project } from "$lib/state/project.svelte";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";
  import Segmented from "../ui/Segmented.svelte";

  type Source = ProjectScan["citations"][number];

  /** Kept while the dialog closes, so its content does not switch away. */
  let mode = $state<"cite" | "add">("cite");
  let setup = $state<BibSetup | null>(null);
  let sources = $state.raw<Source[]>([]);
  let bib = $state("");
  let filter = $state("");
  let chosen = $state<string[]>([]);
  let form = $state<CiteForm>("paren");
  let before = $state("");
  let after = $state("");
  /** The style the document has, and the one chosen here. */
  let style = $state("");
  let shownStyle = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);

  // The new source: looked up, or filled in.
  let id = $state("");
  let kind = $state<SourceKind>("book");
  let fields = $state<Record<string, string>>({});
  /** Fields of a looked-up entry the form does not show; they stay in it. */
  let extra = $state<BibEntry["fields"]>([]);
  let looking = $state(false);

  const sourceKinds = Object.keys(SOURCE_KINDS) as SourceKind[];
  /** A citation goes into a .tex file; in another, sources can only be added. */
  const canCite = $derived(!!project.file?.endsWith(".tex"));
  const tool = $derived(setup?.tool ?? "none");
  const styles = $derived(STYLES[tool === "none" ? "biblatex" : tool]);

  const formNames: Record<CiteForm, () => string> = {
    paren: m.cite_form_paren,
    text: m.cite_form_text,
    foot: m.cite_form_foot,
    plain: m.cite_form_plain,
  };
  const styleNames: Record<string, () => string> = {
    authoryear: m.cite_style_authoryear,
    numeric: m.cite_style_numeric,
    alphabetic: m.cite_style_alphabetic,
    apa: () => "APA",
    ieee: () => "IEEE",
    verbose: m.cite_style_verbose,
  };
  const kindNames: Record<SourceKind, () => string> = {
    book: m.cite_kind_book,
    article: m.cite_kind_article,
    incollection: m.cite_kind_incollection,
    online: m.cite_kind_online,
    thesis: m.cite_kind_thesis,
    misc: m.cite_kind_misc,
  };
  const fieldNames: Record<string, () => string> = {
    author: m.cite_field_author,
    title: m.cite_field_title,
    year: m.cite_field_year,
    publisher: m.cite_field_publisher,
    address: m.cite_field_address,
    edition: m.cite_field_edition,
    isbn: () => "ISBN",
    journal: m.cite_field_journal,
    volume: m.cite_field_volume,
    number: m.cite_field_number,
    pages: m.cite_field_pages,
    doi: () => "DOI",
    booktitle: m.cite_field_booktitle,
    editor: m.cite_field_editor,
    url: () => "URL",
    urldate: m.cite_field_urldate,
    school: m.cite_field_school,
    type: m.cite_field_type,
    howpublished: m.cite_field_howpublished,
  };

  const shown = $derived.by(() => {
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return sources.filter((s) => {
      const haystack = `${s.key} ${s.author} ${s.title} ${s.year}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  });

  const code = $derived(chosen.length ? citeCode(tool === "none" ? "biblatex" : tool, form, chosen, before, after) : "");

  /** The entry the form makes, with the fields of a looked-up one it does not show. */
  const entryText = $derived.by(() => {
    const own = ["author", "title", "year", ...SOURCE_KINDS[kind]];
    const values: BibEntry["fields"] = [
      ...own.map((name) => [name, (fields[name] ?? "").trim()] as [string, string]),
      ...extra.filter(([name]) => !own.includes(name)),
    ].filter(([, value]) => value);
    if (!values.length) return "";
    const entry = { type: entryType(kind, tool), key: "", fields: values };
    entry.key = entryKey(entry);
    return formatEntry(entry);
  });

  /** "Knuth, Donald and Lamport, Leslie" → "Knuth, Lamport". */
  const surnames = (author: string) =>
    author
      .split(/\s+and\s+/)
      .map((name) => (name.includes(",") ? name.split(",")[0] : (name.trim().split(/\s+/).at(-1) ?? "")))
      .join(", ");

  async function show() {
    mode = doc.citationDialog ?? "cite";
    error = null;
    busy = false;
    filter = "";
    chosen = [];
    before = "";
    after = "";
    id = "";
    kind = "book";
    fields = {};
    extra = [];
    try {
      const state = await inserting.citationState();
      setup = state.setup;
      sources = state.sources;
      bib = state.bib;
      // Nothing to cite yet: on to adding the first source.
      if (!sources.length) mode = "add";
      style = state.setup.style ?? "";
      shownStyle = style || (state.setup.tool === "none" ? "authoryear" : "");
      const forms = citeForms(state.setup.tool);
      form = forms.includes(form) ? form : forms[0];
    } catch (err) {
      setup = null;
      sources = [];
      error = errorMessage(err);
    }
  }

  function toggle(key: string) {
    chosen = chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key];
  }

  async function lookUp() {
    if (!id.trim() || looking) return;
    looking = true;
    error = null;
    try {
      const entry = parseEntry(await inserting.lookUpSource(id));
      if (!entry) throw new Error(m.cite_lookup_not_found());
      kind =
        sourceKinds.find((k) => k === entry.type) ?? (entry.type === "phdthesis" || entry.type === "mastersthesis" ? "thesis" : "misc");
      if (entry.type === "inproceedings") kind = "incollection";
      fields = Object.fromEntries(entry.fields);
      extra = entry.fields;
    } catch (err) {
      error = errorMessage(err);
    } finally {
      looking = false;
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = null;
    try {
      if (mode === "add") {
        const key = await inserting.addSource(entryText);
        // On to citing it, the new source chosen.
        const state = await inserting.citationState();
        setup = state.setup;
        sources = state.sources;
        chosen = [key];
        filter = "";
        mode = "cite";
      } else {
        await inserting.insertCitation(chosen, form, before, after);
        // A document set up just now has biblatex's author-year style.
        const had = setup?.tool === "none" ? "authoryear" : style;
        if (shownStyle && shownStyle !== had) await inserting.setCitationStyle(shownStyle);
        doc.citationDialog = null;
      }
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  function bibliography() {
    doc.citationDialog = null;
    doc.listDialog = { kind: "bibliography", line: null };
  }
</script>

<Dialog open={doc.citationDialog !== null} width={680} onopen={show} onclose={() => (doc.citationDialog = null)}>
  <form onsubmit={submit}>
    <header>
      <h1>{mode === "cite" ? m.cite_title() : m.cite_add_title()}</h1>
      <Segmented
        options={[
          { value: "cite", label: m.cite_mode_cite() },
          { value: "add", label: m.cite_mode_add() },
        ]}
        bind:value={mode}
      />
    </header>

    {#if mode === "cite"}
      <input class="filter" type="search" placeholder={m.cite_filter()} bind:value={filter} disabled={busy} />
      <div class="sources" role="listbox" aria-multiselectable="true" aria-label={m.cite_title()}>
        {#each shown as source (source.key)}
          <button
            type="button"
            role="option"
            aria-selected={chosen.includes(source.key)}
            class:selected={chosen.includes(source.key)}
            onclick={() => toggle(source.key)}
            ondblclick={() => (chosen = [source.key])}
          >
            <span class="who">{surnames(source.author) || source.key}{source.year ? ` (${source.year})` : ""}</span>
            <span class="what">{source.title}</span>
            <span class="key">{source.key}</span>
          </button>
        {:else}
          <p class="empty">
            {sources.length ? m.cite_no_match() : m.cite_no_sources()}
            {#if !sources.length}<button type="button" class="link" onclick={() => (mode = "add")}>{m.cite_mode_add()}</button>{/if}
          </p>
        {/each}
      </div>

      <div class="options">
        <label class="field">
          <span>{m.cite_form()}</span>
          <select bind:value={form} disabled={busy}>
            {#each citeForms(tool) as f (f)}<option value={f}>{formNames[f]()}</option>{/each}
          </select>
        </label>
        {#if tool !== "bibtex"}
          <label class="field">
            <span>{m.cite_before()}</span>
            <input bind:value={before} placeholder={m.cite_before_example()} disabled={busy} />
          </label>
        {/if}
        <label class="field">
          <span>{m.cite_after()}</span>
          <input bind:value={after} placeholder={m.cite_after_example()} disabled={busy} />
        </label>
        <label class="field">
          <span>{m.cite_style()}</span>
          <select bind:value={shownStyle} disabled={busy}>
            {#if !shownStyle}<option value="">{m.cite_style_class()}</option>{/if}
            {#if shownStyle && !styles.includes(shownStyle)}<option value={shownStyle}>{shownStyle}</option>{/if}
            {#each styles as s (s)}<option value={s}>{styleNames[s]?.() ?? s}</option>{/each}
          </select>
        </label>
      </div>

      {#if code}<p class="code"><code>{code}</code></p>{/if}
      {#if setup && !setup.printed}
        <p class="hint">
          {m.cite_no_bibliography()}
          <button type="button" class="link" onclick={bibliography}>{m.cite_add_bibliography()}</button>
        </p>
      {/if}
    {:else}
      <div class="lookup">
        <label class="field">
          <span>{m.cite_lookup()}</span>
          <input
            bind:value={id}
            placeholder="10.1145/359576.359579 · 978-0-201-13447-6"
            disabled={busy || looking}
            onkeydown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void lookUp();
              }
            }}
          />
        </label>
        <Button onclick={lookUp} disabled={!id.trim() || looking || busy}>{looking ? m.cite_looking() : m.cite_look_up()}</Button>
      </div>
      <p class="hint">{m.cite_lookup_hint()}</p>

      <div class="entry">
        <label class="field kind">
          <span>{m.cite_kind()}</span>
          <select bind:value={kind} disabled={busy}>
            {#each sourceKinds as k (k)}<option value={k}>{kindNames[k]()}</option>{/each}
          </select>
        </label>
        {#each ["author", "title", "year", ...SOURCE_KINDS[kind]] as name (name)}
          <label class="field" class:wide={name === "title" || name === "author"}>
            <span>{fieldNames[name]?.() ?? name}</span>
            <input
              value={fields[name] ?? ""}
              oninput={(e) => (fields = { ...fields, [name]: e.currentTarget.value })}
              placeholder={name === "author" ? m.cite_author_example() : ""}
              disabled={busy}
            />
          </label>
        {/each}
      </div>
      {#if entryText}<pre class="code">{entryText}</pre>{/if}
      <p class="hint">{m.cite_add_target({ file: bib })}</p>
    {/if}

    {#if error}<p class="error">{error}</p>{/if}

    <footer>
      <Button onclick={() => (doc.citationDialog = null)} disabled={busy}>{m.new_project_cancel()}</Button>
      {#if mode === "cite"}
        <Button type="submit" variant="primary" disabled={busy || !chosen.length || !canCite}>{m.cite_submit()}</Button>
      {:else}
        <Button type="submit" variant="primary" disabled={busy || !fields.title?.trim()}>{m.cite_add_submit()}</Button>
      {/if}
    </footer>
  </form>
</Dialog>

<style>
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-5);
  }

  .filter {
    width: 100%;
    margin-bottom: var(--space-3);
  }

  .sources {
    display: flex;
    flex-direction: column;
    height: 220px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .sources button[role="option"] {
    display: grid;
    grid-template-columns: minmax(120px, auto) 1fr auto;
    gap: var(--space-4);
    align-items: baseline;
    padding: var(--space-3) var(--space-4);
    border: none;
    border-bottom: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--font-sm);
    text-align: left;
  }

  .sources button[role="option"]:hover {
    background: var(--hover);
  }

  .sources button.selected {
    background: var(--pressed);
    box-shadow: inset 3px 0 0 var(--accent-strong);
  }

  .who {
    font-weight: 600;
    white-space: nowrap;
  }

  .what {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .key {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-xs);
  }

  .empty {
    margin: auto;
    padding: var(--space-6);
    color: var(--text-muted);
    font-size: var(--font-sm);
    text-align: center;
  }

  .options {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr);
    /* Where a label takes two lines, the boxes still line up. */
    align-items: end;
    gap: var(--space-4);
    margin-top: var(--space-5);
  }

  .options .field,
  .entry .field {
    margin-bottom: 0;
    min-width: 0;
  }

  /* Padding and border inside the width, so each stays within its column. */
  .options input,
  .options select,
  .entry input,
  .entry select {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
  }

  .code {
    margin: var(--space-4) 0 0;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: var(--font-sm);
    white-space: pre-wrap;
    word-break: break-word;
  }

  pre.code {
    max-height: 140px;
    overflow: auto;
  }

  .lookup {
    display: flex;
    align-items: flex-end;
    gap: var(--space-3);
  }

  .lookup .field {
    flex: 1;
    margin-bottom: 0;
  }

  .entry {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-4);
    margin-top: var(--space-4);
  }

  .entry .wide {
    grid-column: span 3;
  }

  .entry .kind {
    grid-column: span 3;
    max-width: 50%;
  }

  .hint {
    margin: var(--space-3) 0 0;
  }

  .link {
    padding: 0;
    border: none;
    background: none;
    color: var(--accent-strong);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
