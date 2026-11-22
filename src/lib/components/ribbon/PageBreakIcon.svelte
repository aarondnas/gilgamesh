<script lang="ts">
  /** The end of a page and the start of the next, a dashed line between them, drawn like the Lucide icons beside it. */
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
  <path d="M5 2v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2" />
  <path d="M3 12h2M8.33 12h2M13.67 12h2M19 12h2" stroke-width="1.5" />
  <path d="M5 22v-5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v5" />
</svg>
