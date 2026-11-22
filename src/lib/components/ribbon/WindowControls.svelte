<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import Copy from "@lucide/svelte/icons/copy";
  import Minus from "@lucide/svelte/icons/minus";
  import Square from "@lucide/svelte/icons/square";
  import X from "@lucide/svelte/icons/x";
  import { m } from "$lib/paraglide/messages";

  // The main window has no native frame (`decorations: false`), so these replace its buttons.
  const appWindow = getCurrentWindow();
  let maximized = $state(false);

  onMount(() => {
    const refresh = async () => (maximized = await appWindow.isMaximized());
    void refresh();
    const unlisten = appWindow.onResized(() => void refresh());
    return () => void unlisten.then((stop) => stop());
  });
</script>

<div class="controls">
  <button title={m.window_minimize()} aria-label={m.window_minimize()} onclick={() => appWindow.minimize()}>
    <Minus size={16} strokeWidth={1.5} />
  </button>
  <button
    title={maximized ? m.window_restore() : m.window_maximize()}
    aria-label={maximized ? m.window_restore() : m.window_maximize()}
    onclick={() => appWindow.toggleMaximize()}
  >
    {#if maximized}
      <Copy size={13} strokeWidth={1.5} style="transform: scaleX(-1)" />
    {:else}
      <Square size={13} strokeWidth={1.5} />
    {/if}
  </button>
  <!-- close() runs the close-requested handler, which saves unsaved text first. -->
  <button class="close" title={m.window_close()} aria-label={m.window_close()} onclick={() => appWindow.close()}>
    <X size={17} strokeWidth={1.5} />
  </button>
</div>

<style>
  .controls {
    display: flex;
    align-self: stretch;
    margin-left: auto;
  }

  button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--on-accent);
  }

  button:hover {
    background: var(--on-accent-hover);
  }

  /* The red of Windows' own close button. */
  .close:hover {
    background: #c42b1c;
    color: #ffffff;
  }
</style>
