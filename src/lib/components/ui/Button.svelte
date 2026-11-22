<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  interface Props extends HTMLButtonAttributes {
    /**
     * primary: filled accent · secondary: accent outline · outline: neutral
     * outline · ghost: border only on hover · link: inline text link
     */
    variant?: "primary" | "secondary" | "outline" | "ghost" | "link";
    size?: "sm" | "md";
    children: Snippet;
  }

  let { variant = "outline", size = "sm", class: className = "", children, ...rest }: Props = $props();
</script>

<button type="button" class="btn {variant} {size} {className}" {...rest}>
  {@render children()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text);
    font: inherit;
    white-space: nowrap;
  }

  .sm {
    padding: var(--space-1) var(--space-4);
    font-size: var(--font-sm);
  }

  .md {
    padding: var(--space-3) var(--space-6);
    font-size: var(--font-base);
  }

  .primary {
    background: var(--accent-strong);
    border-color: var(--accent-strong);
    color: var(--on-accent-strong);
  }

  .primary:hover:not(:disabled) {
    background: var(--accent-strong-hover);
    border-color: var(--accent-strong-hover);
  }

  .secondary {
    border-color: var(--accent-strong);
    color: var(--accent-strong);
  }

  .outline {
    border-color: var(--border);
    background: var(--surface);
  }

  .secondary:hover:not(:disabled),
  .outline:hover:not(:disabled),
  .ghost:hover:not(:disabled) {
    background: var(--hover);
  }

  .ghost:hover:not(:disabled) {
    border-color: var(--border);
  }

  .btn:active:not(:disabled):not(.link) {
    background: var(--pressed);
  }

  .link {
    padding: 0;
    color: var(--accent-strong);
    text-decoration: underline;
  }

  .btn:disabled {
    opacity: 0.5;
  }
</style>
