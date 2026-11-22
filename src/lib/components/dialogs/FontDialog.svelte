<!--
  The font manager, laid out like a font website: tabs for the kinds of font,
  and pages of cards, each showing the font's name (or the sample text typed
  above) in the font itself. A page holds what the grid fits, turned by
  clicking rather than scrolled through, so fonts load at a reading pace: those
  of the page and the next (see fonts.svelte.ts), the installed ones from disk,
  the others from their package's archive, without installing it, but only
  once the user agreed (asked above the grid the first time, changed in the
  footer) or for a card clicked on. The chosen card's details and "Use", which
  installs the package where needed, sit below.
-->
<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { untrack } from "svelte";
  import type { FontFamily, FontKind } from "$lib/api";
  import { fontModeOf, managedFontKey } from "$lib/latex/fonts";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { formatting } from "$lib/state/formatting.svelte";
  import { fonts } from "$lib/state/fonts.svelte";
  import { locale } from "$lib/state/locale.svelte";
  import { packages } from "$lib/state/packages.svelte";
  import { project } from "$lib/state/project.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";
  import TabUnderline from "../ui/TabUnderline.svelte";

  let filter = $state("");
  let kind = $state<FontKind | "all">("all");
  let installedOnly = $state(false);
  let chosen = $state<FontFamily | null>(null);
  let sample = $state("");
  let installing = $state(false);
  let strip = $state<HTMLElement | null>(null);
  /** A card's least width and its height in px, as `.grid` lays them out. */
  const CARD_WIDTH = 240;
  const CARD_HEIGHT = 132;
  /** How many pages after the shown one load their fonts ahead. */
  const PAGES_AHEAD = 1;
  let grid = $state<HTMLElement | null>(null);

  const kinds: { value: FontKind | "all"; label: () => string }[] = [
    { value: "all", label: m.fonts_kind_all },
    { value: "serif", label: m.fonts_kind_serif },
    { value: "sans", label: m.fonts_kind_sans },
    { value: "mono", label: m.fonts_kind_mono },
    { value: "math", label: m.fonts_kind_math },
    { value: "other", label: m.fonts_kind_other },
  ];
  const kindNames = Object.fromEntries(kinds.map((k) => [k.value, k.label])) as Record<FontKind | "all", () => string>;

  const mode = $derived(fontModeOf(project.config.engine));
  const shown = $derived.by(() => {
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return fonts.families
      .filter((f) => (kind === "all" || f.kind === kind) && (!installedOnly || f.installed))
      .filter((f) => words.every((w) => `${f.name} ${f.package} ${f.description}`.toLowerCase().includes(w)))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
  const byId = $derived(new Map(fonts.families.map((f) => [f.id, f])));
  /** The chosen family as the catalog has it now (installed since it was chosen, say). */
  const current = $derived(chosen && (byId.get(chosen.id) ?? chosen));
  const key = $derived(current ? managedFontKey(current, mode) : null);

  const megabytes = (bytes: number) =>
    new Intl.NumberFormat(locale.current, { maximumFractionDigits: 1 }).format(Math.max(bytes, 100_000) / 1_000_000) + " MB";
  const fontStyle = (family: FontFamily) =>
    fonts.previews[family.id] === "ready" ? `font-family: "${fonts.cssFamily(family)}", var(--font-ui)` : undefined;

  // The chosen family shows its italic and bold too, once its regular face shows; their progress must not run this again.
  $effect(() => {
    const family = current;
    if (family && fonts.previews[family.id] === "ready") untrack(() => void fonts.previewStyles(family));
  });

  // A page holds as many cards as the grid fits, which the window's size decides.
  let columns = $state(4);
  let rows = $state(3);
  /** Counts the measurements of the shown grid (see `seeking`). */
  let measured = $state(0);
  $effect(() => {
    if (!grid) return;
    const measure = () => {
      // Closed, the dialog has no size: the last one holds.
      if (!grid!.clientWidth) return;
      const gap = parseFloat(getComputedStyle(grid!).rowGap) || 0;
      columns = Math.max(1, Math.floor((grid!.clientWidth + gap) / (CARD_WIDTH + gap)));
      rows = Math.max(1, Math.floor((grid!.clientHeight + gap) / (CARD_HEIGHT + gap)));
      measured++;
    };
    untrack(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  });
  const perPage = $derived(columns * rows);
  const pages = $derived(Math.max(1, Math.ceil(shown.length / perPage)));
  let page = $state(0);
  const onPage = $derived(shown.slice(page * perPage, (page + 1) * perPage));

  // A page shrunk away (a larger window) leaves the last.
  $effect(() => {
    if (page >= pages) page = pages - 1;
  });

  /**
   * The cards of the page load their font, then those of the pages after it, so turning
   * the page shows them ready; what earlier pages asked for and did not get is dropped.
   */
  const ahead = $derived(shown.slice((page + 1) * perPage, (page + 1 + PAGES_AHEAD) * perPage));
  $effect(() => {
    const families = [...onPage, ...ahead];
    // Consent given (or withdrawn) asks again.
    void fonts.downloadsAllowed;
    untrack(() => {
      fonts.forgetWanted();
      for (const family of families) fonts.want(family, true);
    });
  });

  async function show() {
    filter = "";
    sample = "";
    await fonts.load();
    chosen = shown.find((f) => managedFontKey(f, mode) === formatting.documentFont) ?? null;
    page = 0;
    seeking = !!chosen;
  }

  /** Whether to turn to the chosen card's page once the open dialog has measured how many a page holds. */
  let seeking = $state(false);
  $effect(() => {
    void measured;
    if (!seeking || !grid?.clientWidth) return;
    const at = chosen ? shown.findIndex((f) => f.id === chosen!.id) : -1;
    page = at < 0 ? 0 : Math.floor(at / perPage);
    seeking = false;
  });

  async function install() {
    if (!current) return false;
    installing = true;
    try {
      return current.installed || (await fonts.install(current));
    } finally {
      installing = false;
    }
  }

  async function use() {
    if (!key || !(await install())) return;
    await formatting.setFont(key);
    fonts.dialog = false;
  }
</script>

<Dialog
  open={fonts.dialog}
  width={1060}
  onopen={show}
  onclose={() => {
    fonts.dialog = false;
    fonts.forgetWanted();
  }}
>
  <div class="head">
    <h1>{m.fonts_title()}</h1>
    <!-- Another search, tab or filter starts at its first page. -->
    <input class="filter" type="search" placeholder={m.fonts_search()} bind:value={filter} oninput={() => (page = 0)} />
    <input class="sample-input" type="text" placeholder={m.fonts_sample()} aria-label={m.fonts_sample()} bind:value={sample} />
    <label class="installed-only">
      <input type="checkbox" bind:checked={installedOnly} onchange={() => (page = 0)} />
      {m.fonts_installed_only()}
    </label>
  </div>

  <div class="tabs" role="tablist" bind:this={strip}>
    {#each kinds as k (k.value)}
      <button
        role="tab"
        class:active={kind === k.value}
        aria-selected={kind === k.value}
        onclick={() => {
          kind = k.value;
          page = 0;
        }}
      >
        {k.label()}
      </button>
    {/each}
    <TabUnderline {strip} index={kinds.findIndex((k) => k.value === kind)} />
  </div>

  {#if !settings.data.fontPreviewsAsked && fonts.families.some((f) => !f.installed)}
    <!-- Fetching previews sends the user's address to the server: only once they agreed. -->
    <div class="consent" role="alert">
      <div>
        <p class="consent-title">{m.fonts_consent_title()}</p>
        <p>{m.fonts_consent_text({ server: fonts.host ?? "TeX Live" })}</p>
      </div>
      <div class="consent-actions">
        <Button
          onclick={() => {
            fonts.allowDownloads(false);
            installedOnly = true;
            page = 0;
          }}
        >
          {m.fonts_consent_decline()}
        </Button>
        <Button variant="primary" onclick={() => fonts.allowDownloads(true)}>{m.fonts_consent_accept()}</Button>
      </div>
    </div>
  {/if}

  <div class="grid" role="listbox" aria-label={m.fonts_title()} bind:this={grid}>
    {#if fonts.loading && !fonts.families.length}
      <p class="empty">{m.fonts_loading()}</p>
    {:else if fonts.error}
      <p class="empty">{m.fonts_error({ error: fonts.error })}</p>
    {:else}
      {#each onPage as family (family.id)}
        {@const state = fonts.previews[family.id]}
        <button
          type="button"
          role="option"
          class="card"
          class:selected={current?.id === family.id}
          aria-selected={current?.id === family.id}
          onclick={() => {
            chosen = family;
            // Clicked on, it shows: the card said so, with the size to fetch.
            void fonts.preview(family, true);
          }}
          ondblclick={() => void use()}
        >
          <span class="specimen" class:pending={state !== "ready"} style={fontStyle(family)}>{sample || family.name}</span>
          <span class="meta">
            <span class="title">{family.name}</span>
            <span class="tags">
              {#if state === "loading"}<span>{m.fonts_loading()}</span>
              {:else if state === "failed"}<span>{m.fonts_preview_none()}</span>
              {:else if state !== "ready" && fonts.onRequest(family)}<span
                  >{m.fonts_preview_on_click({ size: megabytes(family.size) })}</span
                >{/if}
              {#if family.installed}<span class="tag">{m.fonts_installed()}</span>{/if}
              {#if family.sty}<span class="tag">pdfLaTeX</span>{/if}
            </span>
          </span>
        </button>
      {:else}
        <p class="empty">{m.fonts_none()}</p>
      {/each}
    {/if}
  </div>

  <nav class="pager" aria-label={m.fonts_pages()}>
    <Button variant="ghost" onclick={() => page--} disabled={page === 0}>
      <ChevronLeft size={15} />
      {m.fonts_previous()}
    </Button>
    <span>{m.fonts_page({ page: page + 1, pages })}</span>
    <Button variant="ghost" onclick={() => page++} disabled={page >= pages - 1}>
      {m.fonts_next()}
      <ChevronRight size={15} />
    </Button>
  </nav>

  <div class="detail">
    {#if current}
      <div class="about">
        <p class="chosen" style={fontStyle(current)}>
          {current.name}
          {#if current.italic}<i>{m.fonts_italic()}</i>{/if}
          {#if current.bold}<b>{m.fonts_bold()}</b>{/if}
        </p>
        <p class="facts">
          {kindNames[current.kind]()} · <code>{current.package}</code>
          {#if current.sty}· <code>\usepackage{"{"}{current.sty}{"}"}</code>{/if}
          · {m.fonts_faces_count({ count: current.faces })}
          {#if current.license}· {m.fonts_license()} {current.license}{/if}
          · {current.sty ? m.fonts_engines_all() : m.fonts_engines_unicode()}
          {#if !current.installed}· {m.fonts_download()} {megabytes(current.size)}{/if}
        </p>
        {#if current.description}<p class="description">{current.description}</p>{/if}
        {#if !key}<p class="warn">{m.fonts_needs_unicode()}</p>{/if}
      </div>
    {:else}
      <p class="hint">{m.fonts_choose()}</p>
    {/if}
  </div>

  <footer>
    {#if packages.task}
      <span class="task">{packages.task}</span>
    {:else}
      <label class="downloads" title={m.fonts_downloads_title({ server: fonts.host ?? "TeX Live" })}>
        <input type="checkbox" checked={fonts.downloadsAllowed} onchange={(e) => fonts.allowDownloads(e.currentTarget.checked)} />
        {m.fonts_downloads()}
      </label>
    {/if}
    <Button onclick={() => (fonts.dialog = false)}>{m.fonts_close()}</Button>
    {#if current && !current.installed}
      <Button onclick={() => void install()} disabled={installing || !!packages.task}>{m.fonts_install()}</Button>
    {/if}
    <Button variant="primary" onclick={() => void use()} disabled={!key || installing || !!packages.task}>{m.fonts_use()}</Button>
  </footer>
</Dialog>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-3);
  }

  .head h1 {
    margin: 0 var(--space-4) 0 0;
  }

  .filter,
  .sample-input {
    flex: 1;
    min-width: 0;
  }

  .installed-only {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-sm);
    white-space: nowrap;
  }

  /* As the settings' tabs. */
  .tabs {
    position: relative;
    display: flex;
    gap: var(--space-2);
    border-bottom: 1px solid var(--border);
  }

  .tabs button {
    margin-bottom: -1px;
    padding: var(--space-3) var(--space-5);
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--text-muted);
    font: inherit;
    transition: color 150ms ease;
  }

  .tabs button:hover {
    color: var(--text);
  }

  .tabs button.active {
    color: var(--accent-strong);
    font-weight: 600;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    grid-auto-rows: 132px;
    align-content: start;
    gap: var(--space-4);
    /* No scrolling: a page holds what fits (see `perPage`); the pager below turns it. */
    height: 430px;
    margin-top: var(--space-4);
    overflow: hidden;
    padding: 2px;
  }

  .pager {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-5);
    padding: var(--space-3) 0;
    color: var(--text-muted);
    font-size: var(--font-sm);
  }

  .pager span {
    min-width: 110px;
    text-align: center;
  }

  .card {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-4) var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    text-align: left;
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }

  .card:hover {
    border-color: var(--text-muted);
  }

  .card.selected {
    border-color: var(--accent-strong);
    box-shadow: inset 0 0 0 1px var(--accent-strong);
  }

  /* The font itself: large, two lines at most, the name until it has loaded. */
  .specimen {
    display: -webkit-box;
    overflow: hidden;
    font-size: 28px;
    line-height: 1.2;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .specimen.pending {
    color: var(--text-muted);
    opacity: 0.55;
  }

  .meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: var(--font-xs);
  }

  .title {
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--font-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    color: var(--text-muted);
  }

  .tag {
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .empty {
    grid-column: 1 / -1;
    padding: var(--space-6);
    color: var(--text-muted);
    font-size: var(--font-sm);
    text-align: center;
  }

  .detail {
    min-height: 92px;
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }

  .detail p {
    margin: 0 0 var(--space-1);
  }

  .chosen {
    display: flex;
    align-items: baseline;
    gap: var(--space-5);
    font-size: 20px;
  }

  .facts,
  .description,
  .hint {
    color: var(--text-muted);
    font-size: var(--font-sm);
  }

  code {
    font-family: var(--font-mono);
    font-size: var(--font-sm);
  }

  .warn {
    color: var(--error);
    font-size: var(--font-sm);
  }

  .consent {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    margin-top: var(--space-4);
    padding: var(--space-4) var(--space-5);
    border: 1px solid var(--accent-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    font-size: var(--font-sm);
  }

  .consent p {
    margin: 0;
  }

  .consent-title {
    margin-bottom: var(--space-1) !important;
    font-weight: 600;
  }

  .consent-actions {
    display: flex;
    flex-shrink: 0;
    gap: var(--space-3);
  }

  .downloads {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-right: auto;
    color: var(--text-muted);
    font-size: var(--font-sm);
  }

  .task {
    margin-right: auto;
    color: var(--text-muted);
    font-size: var(--font-sm);
  }
</style>
