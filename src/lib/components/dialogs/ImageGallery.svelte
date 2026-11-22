<!--
  The project's images as square tiles of the same size, each cut from the
  middle of its picture; a click chooses one. PDF and EPS show their first page.
-->
<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import { api } from "$lib/api";
  import { extensionOf } from "$lib/config/project-files";
  import { m } from "$lib/paraglide/messages";
  import { pdfThumbnail } from "$lib/pdf/thumbnail";
  import { project } from "$lib/state/project.svelte";
  import { fileName } from "$lib/util/paths";

  interface Props {
    /** Project paths of the images. */
    images: string[];
    selected: string;
    disabled?: boolean;
    onchoose: (path: string) => void;
  }

  let { images, selected, disabled = false, onchoose }: Props = $props();

  /** The tile's size in CSS pixels; also in the CSS below. Drawn at twice that, for sharp screens. */
  const TILE = 88;
  /** Images read at the same time: a folder of photos must not flood the backend. */
  const AT_ONCE = 4;
  const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

  /**
   * Each image's picture once read (`null` where it could not be), kept while
   * the gallery lives: the dialog shows a fresh gallery each time it opens.
   */
  const cache = new Map<string, string | null>();
  /** Being read, so a new list of the same images does not read them twice. */
  const pending = new Set<string>();
  let urls = $state<Record<string, string | null>>({});

  // Reads the images not read yet, e.g. one just dropped in.
  $effect(() => {
    const root = project.root;
    if (!root) return;
    const queue = images.filter((path) => !cache.has(path) && !pending.has(path));
    for (const path of queue) pending.add(path);
    const next = async (): Promise<void> => {
      const path = queue.shift();
      if (path === undefined) return;
      let url: string | null = null;
      try {
        url = URL.createObjectURL(await picture(root, path));
      } catch {
        // Shown as its type instead.
      }
      pending.delete(path);
      if (destroyed) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      cache.set(path, url);
      urls = Object.fromEntries(cache);
      return next();
    };
    for (let i = 0; i < AT_ONCE; i++) void next();
  });

  let destroyed = false;
  $effect(() => () => {
    destroyed = true;
    for (const url of cache.values()) if (url) URL.revokeObjectURL(url);
  });

  /** A picture the browser shows: photos as they are, PDF and EPS as their first page. */
  async function picture(root: string, path: string): Promise<Blob> {
    const ext = extensionOf(path);
    if (TYPES[ext]) return new Blob([await api.projectReadBytes(root, path)], { type: TYPES[ext] });
    const pdf = ext === "eps" ? await api.epsToPdf(root, path) : await api.projectReadBytes(root, path);
    return pdfThumbnail(pdf, TILE * 2);
  }
</script>

{#if images.length}
  <div class="gallery" role="listbox" aria-label={m.image_file()}>
    {#each images as path (path)}
      {@const url = urls[path]}
      <button
        type="button"
        class="tile"
        class:selected={path === selected}
        role="option"
        aria-selected={path === selected}
        title={path}
        {disabled}
        onclick={() => onchoose(path)}
      >
        <span class="picture">
          {#if url}
            <img src={url} alt="" draggable="false" />
          {:else}
            <!-- Still read, or not readable: its type. -->
            <span class="type" class:loading={url === undefined}>{extensionOf(path).toUpperCase()}</span>
          {/if}
          {#if path === selected}<span class="check"><Check size={12} /></span>{/if}
        </span>
        <span class="name">{fileName(path)}</span>
      </button>
    {/each}
  </div>
{:else}
  <p class="empty">{m.image_none()}</p>
{/if}

<style>
  /* Tiles of one size, as many per row as fit; scrolls where there are many. */
  .gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, 88px);
    justify-content: space-between;
    gap: var(--space-3);
    max-height: 236px;
    overflow-y: auto;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    font-weight: normal;
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--font-xs);
  }

  .picture {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 88px;
    height: 88px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  /* The square cut from the middle of the picture. */
  .picture img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .type {
    color: var(--text-muted);
    font-size: var(--font-xs);
    font-weight: 600;
  }

  .type.loading {
    opacity: 0.4;
  }

  .tile:hover:not(:disabled) .picture {
    border-color: var(--text-muted);
  }

  .tile.selected .picture {
    border-color: var(--accent-strong);
    box-shadow: 0 0 0 1px var(--accent-strong);
  }

  .tile.selected {
    color: var(--text);
  }

  .check {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    padding: 2px;
    border-radius: 50%;
    background: var(--accent-strong);
    color: var(--on-accent-strong);
  }

  .check :global(svg) {
    color: inherit;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
  }

  .tile:disabled {
    opacity: 0.6;
  }

  .empty {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--font-sm);
    font-weight: normal;
  }
</style>
