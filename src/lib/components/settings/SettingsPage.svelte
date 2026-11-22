<!--
  The scrolling page of a settings section, shared by all of them: its
  sections in a centered column, with the same headings and muted text.
-->
<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<div class="page">
  {@render children()}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    overflow-y: auto;
    background: var(--surface);
  }

  .page > :global(section) {
    width: min(640px, 100% - 2 * var(--space-6));
    flex-shrink: 0;
    margin-block: var(--space-8);
  }

  .page > :global(section + section) {
    margin-top: 0;
  }

  .page :global(h1) {
    margin: 0 0 var(--space-4);
    font-size: var(--font-lg);
    font-weight: 600;
  }

  .page :global(p) {
    color: var(--text-muted);
    line-height: 1.5;
  }
</style>
