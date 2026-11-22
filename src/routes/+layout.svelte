<script lang="ts">
  import "../app.css";
  // Installs the reactive locale before any message renders.
  import "$lib/state/locale.svelte";
  // Sets light or dark mode before anything renders, then follows the setting.
  import "$lib/state/theme.svelte";
  import { settings } from "$lib/state/settings.svelte";

  let { children } = $props();

  // A few milliseconds; avoids showing the wrong language for a frame.
  void settings.load();
</script>

{#if settings.loaded}
  {@render children()}
{/if}
