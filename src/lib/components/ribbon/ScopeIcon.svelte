<script lang="ts">
  import type { Scope } from "$lib/latex/scope";

  /**
   * What a format button acts on, drawn like the Lucide icons beside it and told
   * apart by outline alone, also at 16px: a word as a marked block, the
   * paragraph and the section by their signs ¶ and §, the document as a page.
   */
  interface Props {
    scope: Scope;
    size?: number;
    class?: string;
  }

  let { scope, size = 24, class: className = "" }: Props = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  aria-hidden="true"
>
  {#if scope === "word"}
    <rect x="3" y="7" width="18" height="10" rx="2" fill="currentColor" fill-opacity="0.25" />
    <path d="M7.5 12h9" />
  {:else if scope === "paragraph"}
    <path d="M13 4v16M17 4v16M19 4H9.5a4.5 4.5 0 0 0 0 9H13" />
  {:else if scope === "section"}
    <path d="M16 5a4 3 0 0 0-8 0c0 4 8 3 8 7a4 3 0 0 1-8 0" />
    <path d="M8 19a4 3 0 0 0 8 0c0-4-8-3-8-7a4 3 0 0 1 8 0" />
  {:else}
    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
    <path d="M14 2v5h5M9 13h6M9 17h6" />
  {/if}
</svg>
