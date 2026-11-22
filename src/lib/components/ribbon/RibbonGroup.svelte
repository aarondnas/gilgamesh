<script lang="ts">
  import type { Snippet } from "svelte";

  let { label, children }: { label: string; children: Snippet } = $props();
</script>

<section class="group">
  <div class="content">{@render children()}</div>
  <div class="label">{label}</div>
</section>

<style>
  .group {
    display: flex;
    flex-direction: column;
    padding: 0 var(--space-4);
    border-right: 1px solid var(--border);
  }

  .content {
    flex: 1;
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
    min-height: 0;
  }

  .label {
    padding-top: var(--space-1);
    text-align: center;
    font-size: var(--font-xs);
    color: var(--text-muted);
  }
</style>
