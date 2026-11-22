<script module lang="ts">
  import type { Counting, NumberFormat, PageRegion } from "$lib/latex/page-numbers";

  export type Region = PageRegion & { page: number | null };
  /** A region's choice in the form: the start number stays while its field is empty. */
  export type Choice = { format: NumberFormat | null; restart: boolean; start: number | null };

  export const countingOf = (choice: Choice): Counting => ({ format: choice.format, start: choice.restart ? choice.start : null });
  export const choiceOf = (counting: Counting): Choice => ({
    format: counting.format,
    restart: counting.start !== null,
    start: counting.start ?? 1,
  });
  export const validChoices = (choices: Choice[]) => choices.every((c) => !c.restart || (Number.isInteger(c.start) && c.start! >= 0));
</script>

<script lang="ts">
  import { FORMATS, sameCounting, type RegionKind } from "$lib/latex/page-numbers";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { build } from "$lib/state/build.svelte";

  /** How the page numbers count in the regions of the body: `choices` by the regions' places, changed in place. */
  let { regions, choices, busy }: { regions: Region[]; choices: Choice[]; busy: boolean } = $props();

  const kindNames: Record<Exclude<RegionKind, "heading">, () => string> = {
    start: m.page_numbers_region_start,
    title: m.page_numbers_region_title,
    abstract: m.page_numbers_region_abstract,
    contents: m.page_numbers_region_contents,
    figures: m.page_numbers_region_figures,
    tables: m.page_numbers_region_tables,
    bibliography: m.page_numbers_region_bibliography,
    index: m.page_numbers_region_index,
    glossary: m.page_numbers_region_glossary,
    appendix: m.page_numbers_region_appendix,
    end: m.page_numbers_region_end,
  };

  const formatNames: Record<NumberFormat, () => string> = {
    arabic: () => "1, 2, 3",
    roman: () => "i, ii, iii",
    Roman: () => "I, II, III",
    alph: () => "a, b, c",
    Alph: () => "A, B, C",
    none: m.page_numbers_none,
  };

  /** Chapters, or sections where the document has no chapters; lower headings only where they switch already. */
  const shown = $derived.by(() => {
    const headings = regions.filter((r) => r.kind === "heading");
    const deepest = headings.some((r) => (r.level ?? 9) <= 1) ? 1 : 2;
    return regions
      .map((region, index) => ({ region, index }))
      .filter(({ region }) => region.kind !== "heading" || (region.level ?? 9) <= deepest || region.switches.length);
  });

  /**
   * The number each region's first page gets, as far as the pages of the last
   * build tell: counted on from the region before where it does not start anew.
   */
  const firstNumbers = $derived.by(() => {
    let format: NumberFormat = "arabic";
    let number: number | null = null;
    let page: number | null = null;
    return regions.map((region, i) => {
      const c = choices[i] ? countingOf(choices[i]) : region.counting;
      format = c.format ?? format;
      if (c.start !== null) number = c.start;
      else if (i === 0) number = region.page === null ? 1 : region.page;
      else number = number !== null && page !== null && region.page !== null ? number + (region.page - page) : null;
      page = region.page;
      return number === null ? "" : formatted(number, format);
    });
  });

  function formatted(n: number, format: NumberFormat): string {
    if (format === "none") return "–";
    if (format === "arabic" || n < 1) return String(n);
    if (format === "alph" || format === "Alph") {
      const letter = n <= 26 ? String.fromCharCode(96 + n) : String(n);
      return format === "Alph" ? letter.toUpperCase() : letter;
    }
    const numerals: [number, string][] = [
      [1000, "m"],
      [900, "cm"],
      [500, "d"],
      [400, "cd"],
      [100, "c"],
      [90, "xc"],
      [50, "l"],
      [40, "xl"],
      [10, "x"],
      [9, "ix"],
      [5, "v"],
      [4, "iv"],
      [1, "i"],
    ];
    let rest = n;
    let roman = "";
    for (const [value, digits] of numerals) {
      while (rest >= value) {
        roman += digits;
        rest -= value;
      }
    }
    return format === "Roman" ? roman.toUpperCase() : roman;
  }

  function label(region: Region): string {
    if (region.kind !== "heading") return kindNames[region.kind]();
    return region.number ? `${region.number} ${region.title}` : region.title;
  }
</script>

<h3>{m.page_numbers_regions()}</h3>
<p class="hint">{m.page_numbers_regions_hint()}</p>
<div class="table">
  <table>
    <thead>
      <tr>
        <th>{m.page_numbers_from()}</th>
        <th class="page">{m.page_numbers_pdf_page()}</th>
        <th>{m.page_numbers_format()}</th>
        <th>{m.page_numbers_counting()}</th>
        <th class="first">{m.page_numbers_first()}</th>
      </tr>
    </thead>
    <tbody>
      {#each shown as { region, index } (index)}
        {@const c = choices[index]}
        <tr class:changed={!sameCounting(region.counting, countingOf(c))}>
          <td class="from" style:padding-left="calc(var(--space-3) + {Math.max(0, (region.level ?? 1) - 1) * 14}px)">
            <span class:muted={region.kind !== "heading"}>{label(region)}</span>
          </td>
          <td class="page">{region.page ?? "–"}</td>
          <td>
            <select bind:value={c.format} disabled={busy}>
              <option value={null}>{index === 0 ? m.page_numbers_default() : m.page_numbers_same()}</option>
              {#each FORMATS as f (f)}
                <option value={f}>{formatNames[f]()}</option>
              {/each}
            </select>
          </td>
          <td>
            <span class="counting">
              <select bind:value={c.restart} disabled={busy}>
                <option value={false}>{index === 0 ? m.page_numbers_default() : m.page_numbers_continue()}</option>
                <option value={true}>{m.page_numbers_restart()}</option>
              </select>
              {#if c.restart}
                <input type="number" min="0" step="1" bind:value={c.start} disabled={busy} aria-label={m.page_numbers_restart()} />
              {/if}
            </span>
          </td>
          <td class="first">{firstNumbers[index]}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
{#if !build.lastResult?.pdfPath}<p class="hint after">{m.page_numbers_no_pdf()}</p>{/if}

<style>
  h3 {
    margin: var(--space-5) 0 var(--space-2);
    font-size: var(--font-sm);
    font-weight: 600;
  }

  .table {
    max-height: 260px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-sm);
  }

  th {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: var(--space-3);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
    font-weight: 600;
    text-align: left;
    white-space: nowrap;
  }

  td {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tr.changed td {
    background: var(--hover);
  }

  .from {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .muted {
    color: var(--text-muted);
    font-style: italic;
  }

  .page,
  .first {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  td select {
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-sm);
  }

  .counting {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .counting input {
    width: 56px;
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-sm);
  }

  .hint {
    margin: 0 0 var(--space-3);
  }

  .hint.after {
    margin: var(--space-3) 0 0;
  }
</style>
