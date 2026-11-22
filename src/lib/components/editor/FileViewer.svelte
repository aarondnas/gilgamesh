<script lang="ts">
  import { extensionOf } from "$lib/config/project-files";
  import type { ImageZoom } from "$lib/state/image-zoom.svelte";
  import ImageView from "./ImageView.svelte";
  import PdfFileView from "./PdfFileView.svelte";

  interface Props {
    /** A project file of a `PROJECT_FILES.viewable` type. */
    path: string;
    zoom: ImageZoom;
  }

  let { path, zoom }: Props = $props();

  /** PDF and EPS have pages, drawn by pdf.js; the others are pictures the webview shows itself. */
  const paged = $derived(["pdf", "eps"].includes(extensionOf(path)));
</script>

{#if paged}
  <PdfFileView {path} {zoom} />
{:else}
  <ImageView {path} {zoom} />
{/if}
