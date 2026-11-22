<script lang="ts">
  import TableIcon from "@lucide/svelte/icons/table";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { inserting } from "$lib/state/inserting.svelte";
  import RibbonButton from "./RibbonButton.svelte";

  /** The quick choice's largest size, as in Word. */
  const COLUMNS = 10;
  const ROWS = 8;
  /** Its size at first; it grows a cell beyond the one under the pointer, up to the largest. */
  const START = 3;
  /** How long the pointer rests on the button before the grid opens. */
  const OPEN_DELAY = 500;
  /** How long the pointer may be away before the grid closes, e.g. on the way from the button to it. */
  const CLOSE_DELAY = 250;

  let { disabled = false }: { disabled?: boolean } = $props();

  let open = $state(false);
  /** The cell under the pointer: the table's size; `null` for none. */
  let size = $state<{ columns: number; rows: number } | null>(null);
  let wrapper: HTMLDivElement | undefined = $state();
  /** Below the button, in window coordinates: the ribbon's panel cuts off what reaches out of it. */
  let at = $state({ top: 0, left: 0 });
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  /** The cells shown: the largest size reached while open, so the grid does not shrink under the pointer. */
  let shown = $state({ columns: START, rows: START });

  function enter() {
    clearTimeout(closeTimer);
    if (disabled || open) return;
    clearTimeout(openTimer);
    openTimer = setTimeout(show, OPEN_DELAY);
  }

  function show() {
    if (disabled || !wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    at = { top: rect.bottom, left: rect.left };
    size = null;
    shown = { columns: START, rows: START };
    open = true;
  }

  function leave() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => (open = false), CLOSE_DELAY);
  }

  function close() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    open = false;
  }

  function point(columns: number, rows: number) {
    size = { columns, rows };
    shown = {
      columns: Math.min(COLUMNS, Math.max(shown.columns, columns + 1)),
      rows: Math.min(ROWS, Math.max(shown.rows, rows + 1)),
    };
  }

  function insert(columns: number, rows: number) {
    close();
    void inserting.insertQuickTable(columns, rows);
  }

  $effect(() => {
    if (disabled) close();
  });
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} onresize={close} />

<div class="table-button" role="none" bind:this={wrapper} onpointerenter={enter} onpointerleave={leave}>
  <RibbonButton
    large
    icon={TableIcon}
    label={m.ribbon_table()}
    title={open ? "" : m.ribbon_table_title()}
    {disabled}
    onclick={() => {
      close();
      doc.tableDialog = true;
    }}
  />
  {#if open}
    <div class="popup" role="dialog" aria-label={m.ribbon_table()} style:top="{at.top}px" style:left="{at.left}px">
      <div class="heading">
        {size ? m.table_quick_size({ columns: size.columns, rows: size.rows }) : m.table_dialog_title()}
      </div>
      <div class="grid" role="group" style:grid-template-columns="repeat({shown.columns}, 16px)" onpointerleave={() => (size = null)}>
        {#each { length: shown.rows }, r (r)}
          {#each { length: shown.columns }, c (c)}
            <button
              class="cell"
              class:marked={size && c < size.columns && r < size.rows}
              aria-label={m.table_quick_size({ columns: c + 1, rows: r + 1 })}
              onpointerenter={() => point(c + 1, r + 1)}
              onfocus={() => point(c + 1, r + 1)}
              onclick={() => insert(c + 1, r + 1)}
            ></button>
          {/each}
        {/each}
      </div>
      <button
        class="more"
        onclick={() => {
          close();
          doc.tableDialog = true;
        }}>{m.table_quick_more()}</button
      >
    </div>
  {/if}
</div>

<style>
  .table-button {
    display: flex;
  }

  .popup {
    position: fixed;
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
  }

  .heading {
    color: var(--text-muted);
    font-size: var(--font-sm);
    white-space: nowrap;
  }

  /* Cells of a fixed size, from the left: the heading's width must not spread them. */
  .grid {
    display: grid;
    justify-content: start;
    gap: 3px;
  }

  .cell {
    width: 16px;
    height: 16px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--surface);
  }

  .cell.marked {
    border-color: var(--accent-strong);
    background: color-mix(in srgb, var(--accent-strong) 25%, var(--surface));
  }

  .more {
    padding: var(--space-2) var(--space-3);
    border: none;
    border-top: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--font-sm);
    text-align: left;
  }

  .more:hover {
    background: var(--hover);
  }
</style>
