<script lang="ts">
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Palette from "@lucide/svelte/icons/palette";
  import type { Component } from "svelte";
  import { isCustomColor, SWATCHES, type XColor } from "$lib/latex/colors";
  import { m } from "$lib/paraglide/messages";

  /**
   * A colour button as in Word: the left part sets the colour shown in the bar
   * under its symbol; the arrow opens the colours, above them the choice that
   * takes the colour away, below them the user's own colours of late and the
   * colour picker for another. The colours lie in the top layer (popover), as
   * the ribbon's panel cuts off what reaches out of it.
   */
  interface Props {
    icon: Component<{ size?: number; class?: string }>;
    /** The colour the left part sets: one of `colors`, or `#ff8800` of the user's own. */
    color: string;
    colors: readonly XColor[];
    /** The user's own colours of late, newest first. */
    recent: readonly string[];
    label: string;
    title: string;
    /** The choice that takes the colour away, e.g. "Automatisch". */
    none: string;
    disabled?: boolean;
    /** A colour, or `null` to take it away. */
    onpick: (color: string | null) => void;
  }

  let { icon: Icon, color, colors, recent, label, title, none, disabled = false, onpick }: Props = $props();

  const names: Record<XColor, () => string> = {
    black: m.color_black,
    darkgray: m.color_darkgray,
    gray: m.color_gray,
    lightgray: m.color_lightgray,
    red: m.color_red,
    orange: m.color_orange,
    brown: m.color_brown,
    olive: m.color_olive,
    yellow: m.color_yellow,
    lime: m.color_lime,
    green: m.color_green,
    teal: m.color_teal,
    cyan: m.color_cyan,
    blue: m.color_blue,
    violet: m.color_violet,
    purple: m.color_purple,
    magenta: m.color_magenta,
    pink: m.color_pink,
  };
  /** A colour of xcolor's by its name; one of the user's own by its value, `#FF8800`. */
  const nameOf = (name: string) => (isCustomColor(name) ? name.toUpperCase() : (names[name as XColor]?.() ?? name));
  const swatchOf = (name: string) => (isCustomColor(name) ? name : (SWATCHES[name as XColor] ?? name));

  const COLUMNS = 7;
  const id = $props.id();
  let wrapper: HTMLDivElement | undefined = $state();
  let list: HTMLDivElement | undefined = $state();
  let picker: HTMLInputElement | undefined = $state();
  let open = $state(false);
  let at = $state({ top: 0, left: 0 });

  function beforeToggle(event: ToggleEvent) {
    if (event.newState !== "open" || !wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    at = { top: rect.bottom + 2, left: rect.left };
  }

  function toggled(event: ToggleEvent) {
    open = event.newState === "open";
    if (open) list?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  }

  function pick(choice: string | null) {
    list?.hidePopover();
    onpick(choice);
  }

  /** The system's colour picker, starting from the colour the button sets where it is one of the user's own. */
  function more() {
    list?.hidePopover();
    if (!picker) return;
    picker.value = swatchOf(color).startsWith("#") ? swatchOf(color) : "#ff8000";
    picker.click();
  }

  /** The arrow keys move through the grid of colours. */
  function move(event: KeyboardEvent) {
    if (!list) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[event.key];
    if (!step) return;
    event.preventDefault();
    const items = [...list.querySelectorAll<HTMLButtonElement>(".swatch")];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    items[current < 0 ? 0 : Math.min(Math.max(current + step, 0), items.length - 1)]?.focus();
  }
</script>

<div class="color-picker" class:open bind:this={wrapper}>
  <button
    class="apply"
    aria-label="{label}: {nameOf(color)}"
    title="{label}: {nameOf(color)} – {title}"
    {disabled}
    onclick={() => onpick(color)}
  >
    <Icon size={16} />
    <span class="bar" style:background={swatchOf(color)}></span>
  </button>
  <button
    class="more"
    popovertarget={id}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-label={m.color_more({ name: label })}
    title={m.color_more({ name: label })}
    {disabled}
  >
    <ChevronDown size={10} />
  </button>
  <!-- Picked in the system's dialog: `change` comes once it is closed, not while the colour is dragged. -->
  <input bind:this={picker} class="native" type="color" tabindex="-1" aria-hidden="true" onchange={(e) => onpick(e.currentTarget.value)} />
</div>

<div
  bind:this={list}
  {id}
  popover="auto"
  class="color-menu"
  role="dialog"
  tabindex="-1"
  aria-label={label}
  style:top="{at.top}px"
  style:left="{at.left}px"
  style:--columns={COLUMNS}
  onbeforetoggle={beforeToggle}
  ontoggle={toggled}
  onkeydown={move}
>
  <button class="row" onclick={() => pick(null)}>{none}</button>
  {#each colors as swatch (swatch)}
    {@render cell(swatch)}
  {/each}
  {#if recent.length}
    <span class="heading">{m.color_recent()}</span>
    {#each recent as swatch (swatch)}
      {@render cell(swatch)}
    {/each}
  {/if}
  <button class="row picker" onclick={more}><Palette size={14} />{m.color_custom()}</button>
</div>

{#snippet cell(swatch: string)}
  <button
    class="swatch"
    aria-pressed={swatch === color}
    aria-label={nameOf(swatch)}
    title={nameOf(swatch)}
    style:background={swatchOf(swatch)}
    onclick={() => pick(swatch)}
  ></button>
{/snippet}

<style>
  .color-picker {
    position: relative;
    display: flex;
    height: 24px;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
  }

  .color-picker:hover:not(:has(:disabled)),
  .color-picker.open {
    border-color: var(--border);
  }

  .color-picker button {
    display: flex;
    align-items: center;
    border: none;
    background: transparent;
    color: var(--accent-strong);
  }

  .color-picker button:hover:not(:disabled) {
    background: var(--hover);
  }

  .color-picker button:active:not(:disabled) {
    background: var(--pressed);
  }

  .color-picker button:disabled {
    opacity: 0.45;
  }

  /* Out of sight, under the button: the system's picker opens where the input is. */
  .native {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 1px;
    height: 1px;
    padding: 0;
    border: 0;
    opacity: 0;
    pointer-events: none;
  }

  /* The symbol with the colour it sets as a bar below it, as in Word. */
  .apply {
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-md) 0 0 var(--radius-md);
  }

  .apply :global(svg) {
    margin-top: -2px;
  }

  .bar {
    width: 16px;
    height: 3px;
    border-radius: 1px;
    /* Light colours stay visible on the light ribbon. */
    box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.35);
  }

  .more {
    padding: 0 2px;
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
  }

  .more :global(svg) {
    color: var(--text-muted);
  }

  .color-menu {
    position: fixed;
    inset: auto;
    margin: 0;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
  }

  .color-menu:popover-open {
    display: grid;
    grid-template-columns: repeat(var(--columns), 20px);
    gap: var(--space-1);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    grid-column: 1 / -1;
    padding: var(--space-2) var(--space-3);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--font-sm);
    text-align: left;
    white-space: nowrap;
  }

  .row:first-child {
    margin-bottom: var(--space-1);
  }

  .row.picker {
    margin-top: var(--space-2);
  }

  .row.picker :global(svg) {
    color: var(--accent-strong);
  }

  .row:hover,
  .row:focus-visible {
    background: var(--hover);
  }

  .heading {
    grid-column: 1 / -1;
    margin-top: var(--space-2);
    color: var(--text-muted);
    font-size: var(--font-xs);
  }

  .swatch {
    width: 20px;
    height: 20px;
    padding: 0;
    border: 1px solid rgb(0 0 0 / 0.25);
    border-radius: var(--radius-sm);
  }

  .swatch:hover,
  .swatch:focus-visible {
    outline: 2px solid var(--accent-strong);
    outline-offset: 1px;
  }

  .swatch[aria-pressed="true"] {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }
</style>
