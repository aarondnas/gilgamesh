<script lang="ts">
  /** A page whose margins are marked by a dashed frame, drawn like the Lucide icons beside it. */
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
  <rect x="3.5" y="1.5" width="17" height="21" rx="2" />
  <rect x="7" y="5" width="10" height="14" stroke-width="1" stroke-dasharray="1.5 1.5" />
  <path d="M9 9h6M9 12h6M9 15h4" stroke-width="1.5" />
</svg>
