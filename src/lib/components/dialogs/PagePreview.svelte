<!--
  A page to scale, `width` px wide: the sheet, the text area inside the
  margins (dashed), and lines of text in it, in as many columns as the
  document sets. For the margins dialog and the ribbon's paper menu.
-->
<script lang="ts">
  import type { Margins } from "$lib/latex/margins";

  interface Props {
    /** Width and height in cm. */
    paper: { width: number; height: number };
    /** In cm; a side not a number (a field being typed in) leaves the whole sheet as text area. */
    margins: Margins;
    width: number;
    columns?: number;
  }

  let { paper, margins, width, columns = 1 }: Props = $props();

  const sides: (keyof Margins)[] = ["top", "bottom", "left", "right"];
  const scale = $derived(width / paper.width);
  const height = $derived(paper.height * scale);
  const ok = $derived(sides.every((s) => typeof margins[s] === "number" && margins[s] >= 0));
  const x = $derived(ok ? margins.left * scale : 0);
  const y = $derived(ok ? margins.top * scale : 0);
  const w = $derived(ok ? Math.max(0, width - (margins.left + margins.right) * scale) : width);
  const h = $derived(ok ? Math.max(0, height - (margins.top + margins.bottom) * scale) : height);
  const gap = $derived(Math.max(3, width / 14));
  /** The columns' text, side by side with a gap of about LaTeX's `\columnsep` between them. */
  const columnSep = $derived(columns > 1 ? Math.max(2, 0.35 * 2.54 * scale) : 0);
  const columnWidth = $derived((w - columnSep * (columns - 1)) / columns);
</script>

<svg class="page" {width} {height} viewBox="0 0 {width} {height}" aria-hidden="true">
  <rect class="sheet" x="0.5" y="0.5" width={width - 1} height={height - 1} rx="1.5" />
  {#each { length: columns } as _, c (c)}
    {@const left = x + c * (columnWidth + columnSep)}
    {#each { length: Math.floor(h / gap) } as _, i (i)}
      <line
        class="text"
        x1={left}
        x2={left + (i % 5 === 4 ? columnWidth * 0.6 : columnWidth)}
        y1={y + gap * (i + 0.6)}
        y2={y + gap * (i + 0.6)}
      />
    {/each}
  {/each}
  <rect class="area" {x} {y} width={w} height={h} />
</svg>

<style>
  .page {
    flex-shrink: 0;
    filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.15));
  }

  .sheet {
    fill: #fff;
    stroke: var(--border);
  }

  .area {
    fill: none;
    stroke: var(--accent-strong);
    stroke-width: 1;
    stroke-dasharray: 3 2;
  }

  .text {
    stroke: #c8ccd2;
    stroke-width: 1;
  }
</style>
