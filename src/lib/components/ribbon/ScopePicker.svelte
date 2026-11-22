<script lang="ts" generics="S extends Scope">
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Circle from "@lucide/svelte/icons/circle";
  import CircleDot from "@lucide/svelte/icons/circle-dot";
  import type { Scope } from "$lib/latex/scope";
  import { m } from "$lib/paraglide/messages";
  import type { RibbonChoice } from "$lib/state/ribbon-choices.svelte";
  import ScopeIcon from "./ScopeIcon.svelte";

  /**
   * What a format button acts on, as a symbol right beside it; a click opens
   * the choices, each symbol with its name, and beside them a column that
   * makes one the default the tab opens with. The list lies in the top layer
   * (popover), as the ribbon's panel cuts off what reaches out of it.
   */
  interface Props {
    choice: RibbonChoice<S>;
    scopes: readonly S[];
    /** The accessible name, e.g. "Font for"; the choice is added to it. */
    label: string;
    title: string;
    disabled?: boolean;
  }

  let { choice, scopes, label, title, disabled = false }: Props = $props();

  const names: Record<Scope, () => string> = {
    word: m.scope_word,
    paragraph: m.scope_paragraph,
    section: m.scope_section,
    document: m.scope_document,
  };

  const id = $props.id();
  let button: HTMLButtonElement | undefined = $state();
  let list: HTMLDivElement | undefined = $state();
  let open = $state(false);
  /** Below the button, in window coordinates. */
  let at = $state({ top: 0, left: 0 });

  function beforeToggle(event: ToggleEvent) {
    if (event.newState !== "open" || !button) return;
    const rect = button.getBoundingClientRect();
    at = { top: rect.bottom + 2, left: rect.left };
  }

  function toggled(event: ToggleEvent) {
    open = event.newState === "open";
    if (open) list?.querySelector<HTMLButtonElement>('.choose[aria-pressed="true"]')?.focus();
  }

  function choose(scope: S) {
    choice.value = scope;
    list?.hidePopover();
    button?.focus();
  }

  /** Up and down move within a column, left and right between the two, as in a table. */
  function move(event: KeyboardEvent) {
    if (!list) return;
    const keys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const focused = document.activeElement as HTMLButtonElement;
    const column =
      event.key === "ArrowLeft"
        ? "choose"
        : event.key === "ArrowRight"
          ? "default"
          : focused.classList.contains("default")
            ? "default"
            : "choose";
    const items = [...list.querySelectorAll<HTMLButtonElement>(`.${column}`)];
    const row = Math.max(
      0,
      [...list.querySelectorAll<HTMLButtonElement>(focused.classList.contains("default") ? ".default" : ".choose")].indexOf(focused),
    );
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (row + 1) % items.length
            : event.key === "ArrowUp"
              ? (row - 1 + items.length) % items.length
              : row;
    items[next]?.focus();
  }
</script>

<button
  bind:this={button}
  class="scope-picker"
  class:open
  popovertarget={id}
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-label="{label} {names[choice.value]()}"
  title="{names[choice.value]()} – {title} {m.scope_fallback({ scope: names[choice.fallback]() })}"
  {disabled}
>
  <ScopeIcon scope={choice.value} size={16} />
  <ChevronDown size={10} class="chevron" />
</button>

<div
  bind:this={list}
  {id}
  popover="auto"
  class="scope-menu"
  role="dialog"
  tabindex="-1"
  aria-label={label}
  style:top="{at.top}px"
  style:left="{at.left}px"
  onbeforetoggle={beforeToggle}
  ontoggle={toggled}
  onkeydown={move}
>
  <span></span>
  <span class="heading">{m.scope_default()}</span>
  {#each scopes as scope (scope)}
    <button class="choose" aria-pressed={scope === choice.value} onclick={() => choose(scope)}>
      <ScopeIcon {scope} size={16} />
      {names[scope]()}
    </button>
    <button
      class="default"
      aria-pressed={scope === choice.fallback}
      aria-label={m.scope_set_default({ scope: names[scope]() })}
      title={m.scope_set_default({ scope: names[scope]() })}
      onclick={() => choice.setDefault(scope)}
    >
      {#if scope === choice.fallback}<CircleDot size={14} />{:else}<Circle size={14} />{/if}
    </button>
  {/each}
</div>

<style>
  .scope-picker {
    display: flex;
    align-items: center;
    gap: 1px;
    height: 24px;
    padding: 0 var(--space-1) 0 var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--accent-strong);
  }

  .scope-picker:hover:not(:disabled),
  .scope-picker.open {
    background: var(--hover);
    border-color: var(--border);
  }

  .scope-picker:active:not(:disabled) {
    background: var(--pressed);
  }

  .scope-picker:disabled {
    opacity: 0.45;
  }

  .scope-picker :global(.chevron) {
    color: var(--text-muted);
  }

  /* The popover's own placement (centred in the window) gives way to the one below the button. */
  .scope-menu {
    position: fixed;
    inset: auto;
    margin: 0;
    width: max-content;
    padding: var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
  }

  /* The choices, and beside them which is the default. */
  .scope-menu:popover-open {
    display: grid;
    grid-template-columns: auto auto;
    column-gap: var(--space-2);
    row-gap: 1px;
    align-items: center;
  }

  .scope-menu .heading {
    padding: var(--space-1) var(--space-2) 0;
    color: var(--text-muted);
    font-size: var(--font-xs);
    text-align: center;
  }

  .scope-menu button {
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

  .scope-menu button:hover,
  .scope-menu button:focus-visible {
    background: var(--hover);
  }

  .scope-menu .default {
    justify-content: center;
    padding: var(--space-2);
  }

  .scope-menu .default :global(svg) {
    color: var(--text-muted);
  }

  .scope-menu .default[aria-pressed="true"] :global(svg) {
    color: var(--accent-strong);
  }

  .scope-menu .choose[aria-pressed="true"] {
    background: var(--pressed);
    font-weight: 600;
  }

  .scope-menu :global(svg) {
    color: var(--accent-strong);
    flex-shrink: 0;
  }
</style>
