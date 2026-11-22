<script lang="ts">
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { project } from "$lib/state/project.svelte";

  const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
</script>

{#if project.recent.length > 0}
  <h2>{m.start_recent()}</h2>
  <ul>
    {#each project.recent as root (root)}
      <li>
        <button onclick={() => doc.openProject(root)}>
          <strong>{folderName(root)}</strong>
          <span>{root}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  h2 {
    margin: var(--space-7) 0 var(--space-3);
    font-size: var(--font-sm);
    font-weight: 600;
    color: var(--text-muted);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li button {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
  }

  li button:hover {
    background: var(--hover);
  }

  li span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-sm);
    color: var(--text-muted);
  }
</style>
