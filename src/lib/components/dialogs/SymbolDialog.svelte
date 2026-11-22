<script lang="ts">
  import { api } from "$lib/api";
  import { loadCatalogFonts } from "$lib/util/font-preview";
  import { fontModeOf } from "$lib/latex/fonts";
  import { OPERATORS } from "$lib/latex/math";
  import {
    hasCyrillicText,
    loadCharSymbols,
    SYMBOL_CATEGORIES,
    symbolTextFor,
    type CharSymbol,
    type SymbolCategory,
  } from "$lib/latex/symbols";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { inserting } from "$lib/state/inserting.svelte";
  import { project } from "$lib/state/project.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";

  /** How many characters "recently used" keeps. */
  const RECENT = 16;

  let all = $state.raw<CharSymbol[]>([]);
  /** A group of the table, the characters last inserted, or the operators formulas use most. */
  let category = $state<SymbolCategory | "recent" | "operators">("punctuation");
  let filter = $state("");
  let chosen = $state<CharSymbol | null>(null);
  /** Whether the document's text is Cyrillic (T2A), which pdfLaTeX's Cyrillic letters need. */
  let cyrillic = $state(false);
  let fallbackLoaded = false;

  const categoryNames: Record<SymbolCategory, () => string> = {
    punctuation: m.symbols_cat_punctuation,
    latin: m.symbols_cat_latin,
    greek: m.symbols_cat_greek,
    currency: m.symbols_cat_currency,
    symbols: m.symbols_cat_symbols,
    letterlike: m.symbols_cat_letterlike,
    numbers: m.symbols_cat_numbers,
    math: m.symbols_cat_math,
    arrows: m.symbols_cat_arrows,
    cyrillic: m.symbols_cat_cyrillic,
    ipa: m.symbols_cat_ipa,
  };

  const mode = $derived(fontModeOf(project.config.engine));
  /** How each sets as text in this document; what has none and no math command is not offered. */
  const textOf = (s: CharSymbol) => symbolTextFor(s, mode, cyrillic);
  const offered = $derived(all.filter((s) => textOf(s) || s.math));
  const chosenText = $derived(chosen ? textOf(chosen) : null);
  const chosenPackages = $derived(
    chosen
      ? [...new Set([...(chosenText?.packages ?? []), ...(chosenText?.setup === "symbolfont" ? ["fontspec"] : []), ...chosen.mathPackages])]
      : [],
  );
  const recent = $derived(
    settings.data.recentSymbols.map((char) => offered.find((s) => s.char === char)).filter((s): s is CharSymbol => !!s),
  );
  const categories = $derived(SYMBOL_CATEGORIES.filter((c) => offered.some((s) => s.category === c)));
  /** The formula operators (latex/math.ts), with their commands; as math, also in running text (in `$…$`). */
  const operators = $derived(
    OPERATORS.map((op): CharSymbol => ({
      char: op.symbol,
      category: "math",
      name: all.find((s) => s.char === op.symbol)?.name ?? op.command,
      text: { pdflatex: null, unicode: null },
      math: op.command,
      mathPackages: op.packages,
    })),
  );

  const shown = $derived.by(() => {
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      return offered.filter((s) => {
        if (words.length === 1 && s.char === filter.trim()) return true;
        const haystack = `${s.name} ${textOf(s)?.code ?? ""} ${s.math ?? ""}`.toLowerCase();
        return words.every((w) => haystack.includes(w));
      });
    }
    if (category === "recent") return recent;
    if (category === "operators") return operators;
    return offered.filter((s) => s.category === category);
  });

  /** "COPYRIGHT SIGN" → "Copyright sign". */
  const nameOf = (s: CharSymbol) => s.name[0] + s.name.slice(1).toLowerCase();
  const codepoint = (s: CharSymbol) => `U+${s.char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;

  /** The fallback font from the distribution, so the dialog shows what \textsymbol sets; the system's fonts without it. */
  function loadFallbackFont() {
    if (fallbackLoaded || typeof FontFace === "undefined") return;
    fallbackLoaded = true;
    api
      .texFont("gnu-freefont/FreeSerif.otf")
      .then((bytes) => new FontFace("Gilgamesh FreeSerif", bytes).load())
      .then((face) => document.fonts.add(face))
      .catch(() => {});
  }

  async function show() {
    filter = "";
    loadCatalogFonts();
    loadFallbackFont();
    cyrillic = project.config.main ? hasCyrillicText(await project.mainSource().catch(() => "")) : false;
    if (!all.length) all = await loadCharSymbols();
    if (category !== "recent" && category !== "operators" && !categories.includes(category)) category = categories[0];
    chosen = shown[0] ?? null;
  }

  function pick(c: SymbolCategory | "recent" | "operators") {
    category = c;
    filter = "";
    chosen = shown[0] ?? null;
  }

  async function insert(symbol = chosen) {
    if (!symbol) return;
    await inserting.insertCharSymbol(symbol);
    settings.update({ recentSymbols: [symbol.char, ...settings.data.recentSymbols.filter((c) => c !== symbol.char)].slice(0, RECENT) });
  }
</script>

<Dialog open={doc.symbolDialog} width={780} onopen={show} onclose={() => (doc.symbolDialog = false)}>
  <h1>{m.symbols_title()}</h1>

  <input class="filter" type="search" placeholder={m.symbols_search()} bind:value={filter} />
  <div class="body">
    <nav class:searching={filter.trim()}>
      {#if recent.length}
        <button type="button" class:current={category === "recent"} onclick={() => pick("recent")}>{m.symbols_recent()}</button>
      {/if}
      <button type="button" class:current={category === "operators"} onclick={() => pick("operators")}>{m.ribbon_operators()}</button>
      {#each categories as c (c)}
        <button type="button" class:current={category === c} onclick={() => pick(c)}>{categoryNames[c]()}</button>
      {/each}
    </nav>
    <div class="grid" role="listbox" aria-label={m.symbols_title()}>
      {#each shown as symbol (symbol.char)}
        <button
          type="button"
          role="option"
          aria-selected={chosen === symbol}
          class:selected={chosen === symbol}
          title={nameOf(symbol)}
          onclick={() => (chosen = symbol)}
          ondblclick={() => void insert(symbol)}
        >
          {symbol.char}
        </button>
      {:else}
        <p class="empty">{m.symbols_none()}</p>
      {/each}
    </div>
  </div>

  <div class="info">
    {#if chosen}
      <span class="big" aria-hidden="true">{chosen.char}</span>
      <div>
        <p class="name">{nameOf(chosen)} <span class="muted">{codepoint(chosen)}</span></p>
        <p class="code">
          {#if chosenText}<code>{chosenText.code}</code>{/if}
          {#if chosen.math}<code>{chosenText ? chosen.math : `$${chosen.math}$`}</code>{/if}
        </p>
        {#if chosenText?.setup === "symbolfont"}
          <p class="hint">{m.symbols_fallback_font()}</p>
        {:else if chosenText?.setup === "T2A"}
          <p class="hint">{m.symbols_cyrillic_text()}</p>
        {:else if !chosenText}
          <p class="hint">{m.symbols_math_only()}</p>
        {/if}
        {#if chosenPackages.length}
          <p class="hint">{m.symbols_packages({ packages: chosenPackages.join(", ") })}</p>
        {/if}
      </div>
    {/if}
  </div>

  <footer>
    <Button onclick={() => (doc.symbolDialog = false)}>{m.symbols_close()}</Button>
    <Button variant="primary" onclick={() => void insert()} disabled={!chosen}>{m.symbols_insert()}</Button>
  </footer>
</Dialog>

<style>
  .filter {
    width: 100%;
    margin-bottom: var(--space-3);
  }

  .body {
    display: grid;
    grid-template-columns: 190px 1fr;
    gap: var(--space-4);
    height: 300px;
  }

  nav {
    display: flex;
    flex-direction: column;
    overflow: auto;
  }

  nav.searching {
    opacity: 0.5;
  }

  nav button {
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--font-sm);
    text-align: left;
  }

  nav button:hover {
    background: var(--hover);
  }

  nav button.current {
    background: var(--pressed);
    font-weight: 600;
  }

  /* The characters as the PDF shows them: in Latin Modern, the default font, and FreeSerif, the fallback. */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, 36px);
    grid-auto-rows: 36px;
    align-content: start;
    gap: 2px;
    overflow: auto;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .grid button,
  .big {
    font-family: "Latin Modern Roman", "Gilgamesh FreeSerif", "Cambria Math", "STIX Two Math", "Segoe UI Symbol", serif;
  }

  .grid button {
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font-size: var(--font-lg);
  }

  .grid button:hover {
    background: var(--hover);
  }

  .grid button.selected {
    border-color: var(--accent-strong);
    background: var(--pressed);
  }

  .empty {
    grid-column: 1 / -1;
    padding: var(--space-6);
    color: var(--text-muted);
    font-size: var(--font-sm);
    text-align: center;
  }

  .info {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    min-height: 72px;
    margin-top: var(--space-4);
  }

  .info p {
    margin: 0;
  }

  .big {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-size: 36px;
  }

  .name {
    font-weight: 600;
  }

  .muted {
    color: var(--text-muted);
    font-weight: normal;
  }

  .code {
    display: flex;
    gap: var(--space-4);
    margin-top: var(--space-1) !important;
  }

  code {
    font-family: var(--font-mono);
    font-size: var(--font-sm);
  }

  .hint {
    margin-top: var(--space-1) !important;
  }
</style>
