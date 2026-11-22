<script lang="ts" generics="T extends string | number | boolean">
  interface Props {
    options: { value: T; label: string }[];
    value: T;
  }

  let { options, value = $bindable() }: Props = $props();
</script>

<div class="segmented" role="radiogroup">
  {#each options as option (option.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === option.value}
      class:active={value === option.value}
      onclick={() => (value = option.value)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .segmented {
    display: flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  button {
    padding: var(--space-2) var(--space-5);
    border: none;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--font-sm);
  }

  button:hover:not(.active) {
    background: var(--hover);
  }

  button.active {
    background: var(--accent-strong);
    color: var(--on-accent-strong);
  }
</style>
