<script lang="ts">
  /** Lines of text with a double arrow beside them, as Word draws line spacing, in the manner of the Lucide icons beside it. */
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
  <path d="M3 7l3-3 3 3M6 4v16M3 17l3 3 3-3" />
  <path d="M12 6h9M12 12h9M12 18h9" />
</svg>
