<script lang="ts">
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import type { Component, Snippet } from "svelte";

  export interface MenuItem {
    label: string;
    icon?: Component<{ size?: number; class?: string }>;
    title?: string;
    /** Marks the choice in effect, of choices that exclude each other (a radio group); none for plain commands. */
    checked?: boolean;
    /** A heading above the item, which starts a group of choices. */
    heading?: string;
    /** An example of what the item inserts, as a MathML `<math>` element, shown beside its name. */
    example?: string;
    /** In a grid menu, a row of its own across the columns, e.g. "More symbols …" below them. */
    wide?: boolean;
    onclick: () => void;
  }

  interface Props {
    icon: Component<{ size?: number; class?: string }>;
    label: string;
    title?: string;
    large?: boolean;
    /** Shows only the icon; `label` stays as the accessible name. */
    iconOnly?: boolean;
    /** Marks the button as the current selection, e.g. the open settings section. */
    active?: boolean;
    disabled?: boolean;
    spin?: boolean;
    /** Not needed with `menu`: a click then opens the menu. */
    onclick?: () => void;
    /** Choices a click offers, in a menu below the button. */
    menu?: MenuItem[];
    /** Lays the menu out as a grid of this many columns, e.g. for symbols; `title` then names each. */
    columns?: number;
    /** Sets a long menu's groups (each from a `heading` on) side by side in this many columns. */
    groupColumns?: number;
    /** Beside a plain menu, what its items do, for the one under the pointer or focus (its index; `null` for none). */
    preview?: Snippet<[number | null]>;
  }

  let {
    icon: Icon,
    label,
    title,
    large = false,
    iconOnly = false,
    active = false,
    disabled = false,
    spin = false,
    onclick,
    menu,
    columns,
    groupColumns,
    preview,
  }: Props = $props();

  let menuOpen = $state(false);
  /** The item under the pointer or focus, for `preview`. */
  let hovered = $state<number | null>(null);
  let wrapper: HTMLDivElement | undefined = $state();
  let menuElement: HTMLDivElement | undefined = $state();
  /** Below the button, in window coordinates: the ribbon's panel cuts off what reaches out of it. */
  let menuAt = $state({ top: 0, left: 0 });

  /** The items in groups, a new one at each heading, for `groupColumns`. */
  const groups = $derived.by(() => {
    const list: MenuItem[][] = [];
    for (const item of menu ?? []) {
      if (item.heading || !list.length) list.push([]);
      list[list.length - 1].push(item);
    }
    return list;
  });

  // A menu wider than the room right of its button moves left, to stay in the window.
  $effect(() => {
    if (!menuOpen || !menuElement) return;
    const overflow = menuElement.getBoundingClientRect().right - (window.innerWidth - 8);
    if (overflow > 0) menuAt = { ...menuAt, left: Math.max(8, menuAt.left - overflow) };
  });

  function click() {
    if (menu && !menuOpen && wrapper) {
      const rect = wrapper.getBoundingClientRect();
      menuAt = { top: rect.bottom, left: rect.left };
    }
    hovered = null;
    if (menu) menuOpen = !menuOpen;
    else onclick?.();
  }

  function choose(item: MenuItem) {
    menuOpen = false;
    item.onclick();
  }

  /** A click anywhere else closes the menu. */
  function closeOutside(event: PointerEvent) {
    if (menuOpen && !wrapper?.contains(event.target as Node)) menuOpen = false;
  }
</script>

<svelte:window
  onpointerdown={closeOutside}
  onkeydown={(e) => e.key === "Escape" && (menuOpen = false)}
  onresize={() => (menuOpen = false)}
/>

{#if menu}
  <div class="with-menu" bind:this={wrapper}>
    {@render button()}
    {#if menuOpen}
      <div
        class="menu"
        class:grid={columns}
        class:grouped={groupColumns}
        class:with-preview={preview && !columns && !groupColumns}
        role="menu"
        bind:this={menuElement}
        style:top="{menuAt.top}px"
        style:left="{menuAt.left}px"
        style:max-height="calc(100vh - {menuAt.top + 8}px)"
        style:grid-template-columns={columns ? `repeat(${columns}, 1fr)` : undefined}
        style:column-count={groupColumns}
      >
        {#if groupColumns}
          {#each groups as group, i (i)}
            <div class="group">
              {#each group as item, k (k)}{@render entry(item)}{/each}
            </div>
          {/each}
        {:else if preview}
          <div class="items" role="none" onpointerleave={() => (hovered = null)}>
            {#each menu as item, i (i)}{@render entry(item, i)}{/each}
          </div>
          <div class="preview" aria-hidden="true">{@render preview(hovered)}</div>
        {:else}
          {#each menu as item, i (i)}{@render entry(item)}{/each}
        {/if}
      </div>
    {/if}
  </div>
{:else}
  {@render button()}
{/if}

{#snippet entry(item: MenuItem, index: number | null = null)}
  {#if item.heading}<span class="heading">{item.heading}</span>{/if}
  <button
    role={item.checked === undefined ? "menuitem" : "menuitemradio"}
    aria-checked={item.checked}
    class:checked={item.checked}
    class:wide={item.wide}
    title={item.title}
    onclick={() => choose(item)}
    onpointerenter={() => index !== null && (hovered = index)}
    onfocus={() => index !== null && (hovered = index)}
  >
    {#if item.icon}<item.icon size={16} />{/if}
    {item.label}
    <!-- The examples are the app's own markup, not the user's. -->
    {#if item.example}<span class="example" aria-hidden="true">{@html item.example}</span>{/if}
  </button>
{/snippet}

{#snippet button()}
  <button
    class="ribbon-button"
    class:large
    class:icon-only={iconOnly}
    class:active={active || menuOpen}
    aria-pressed={active ? true : undefined}
    aria-haspopup={menu ? "menu" : undefined}
    aria-expanded={menu ? menuOpen : undefined}
    aria-label={iconOnly ? label : undefined}
    {disabled}
    title={title ?? label}
    onclick={click}
  >
    <Icon size={large ? 26 : 16} class={spin ? "spin" : ""} />
    {#if !iconOnly}
      <span class="caption"
        >{label}{#if menu}<ChevronDown size={12} class="chevron" />{/if}</span
      >
    {/if}
  </button>
{/snippet}

<style>
  .ribbon-button {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-4);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--font-sm);
    white-space: nowrap;
  }

  .ribbon-button.large {
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2);
    min-width: 58px;
    height: 100%;
    padding: var(--space-2) var(--space-4);
  }

  .ribbon-button.icon-only {
    padding: var(--space-3);
  }

  .ribbon-button:hover:not(:disabled) {
    background: var(--hover);
    border-color: var(--border);
  }

  .ribbon-button.active {
    background: var(--hover);
    border-color: var(--border);
  }

  .ribbon-button:active:not(:disabled) {
    background: var(--pressed);
  }

  .ribbon-button:disabled {
    opacity: 0.45;
  }

  .with-menu {
    position: relative;
    display: flex;
  }

  .menu {
    position: fixed;
    z-index: 20;
    display: flex;
    flex-direction: column;
    width: max-content;
    margin-top: var(--space-1);
    padding: var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
  }

  .menu {
    overflow-y: auto;
  }

  /* The items, and beside them what the one under the pointer does. */
  .menu.with-preview {
    flex-direction: row;
    gap: var(--space-2);
  }

  .menu.with-preview .items {
    display: flex;
    flex-direction: column;
  }

  .menu .preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    min-width: 170px;
    padding: var(--space-4);
    border-left: 1px solid var(--border);
  }

  /* Groups side by side, each kept whole in its column. */
  .menu.grouped {
    display: block;
    column-gap: var(--space-4);
  }

  .menu .group {
    display: flex;
    flex-direction: column;
    break-inside: avoid;
  }

  .menu .group + .group {
    margin-top: var(--space-2);
  }

  .menu button {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--font-sm);
    text-align: left;
    white-space: nowrap;
  }

  .menu button:hover {
    background: var(--hover);
  }

  .menu .heading {
    padding: var(--space-2) var(--space-4) var(--space-1);
    color: var(--text-muted);
    font-size: var(--font-xs);
  }

  .menu .heading:not(:first-child) {
    margin-top: var(--space-1);
    border-top: 1px solid var(--border);
  }

  /* Right of the names, in a column of its own. */
  .menu .example {
    display: flex;
    justify-content: center;
    min-width: 72px;
    margin-left: auto;
    padding: var(--space-1) 0 var(--space-1) var(--space-6);
  }

  .menu .example :global(math) {
    font-family: "Cambria Math", "STIX Two Math", math;
    font-size: var(--font-base);
  }

  .menu button.checked {
    background: var(--pressed);
    font-weight: 600;
  }

  /* Symbols side by side, each in a square cell. */
  .menu.grid {
    display: grid;
    gap: 2px;
  }

  .menu.grid button {
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    font-family: "Cambria Math", "STIX Two Math", "Segoe UI Symbol", serif;
    font-size: var(--font-lg);
    text-align: center;
  }

  .menu.grid button.wide {
    grid-column: 1 / -1;
    justify-content: flex-start;
    width: auto;
    margin-top: var(--space-1);
    padding: 0 var(--space-4);
    border-top: 1px solid var(--border);
    border-radius: 0;
    font-family: inherit;
    font-size: var(--font-sm);
  }

  .caption {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .menu :global(svg) {
    color: var(--accent-strong);
    flex-shrink: 0;
  }

  .ribbon-button :global(svg) {
    color: var(--accent-strong);
    flex-shrink: 0;
  }
</style>
