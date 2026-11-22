<script lang="ts">
  /** A numbered item with two items a level below it, drawn like Lucide's list icons beside it. */
  interface Props {
    size?: number;
    class?: string;
  }

  let { size = 24, class: className = "" }: Props = $props();
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
  <path d="M4 3h1v5M4 8h2" />
  <path d="M10 5h11" />
  <path d="M9 13h.01M9 19h.01" />
  <path d="M13 13h8M13 19h8" />
</svg>
