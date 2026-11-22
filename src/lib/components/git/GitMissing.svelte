<script lang="ts">
  import Download from "@lucide/svelte/icons/download";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { m } from "$lib/paraglide/messages";
  import Button from "../ui/Button.svelte";

  /**
   * Gilgamesh ships no Git of its own: without one installed, this says so and
   * leads to the download. Opened only on the user's click, in their browser.
   */
  const DOWNLOAD_URL = "https://git-scm.com/downloads";

  interface Props {
    /** Looks for Git again, once it is installed. */
    onretry: () => unknown;
  }

  let { onretry }: Props = $props();
  let checking = $state(false);

  async function retry() {
    checking = true;
    try {
      await onretry();
    } finally {
      checking = false;
    }
  }
</script>

<div class="missing" role="alert">
  <p>{m.git_not_found()}</p>
  <div class="actions">
    <Button variant="primary" size="md" title={m.git_download_title()} onclick={() => openUrl(DOWNLOAD_URL)}>
      <Download size={15} />{m.git_download()}
    </Button>
    <Button size="md" disabled={checking} onclick={retry}>
      <RefreshCw size={15} />{m.git_recheck()}
    </Button>
  </div>
</div>

<style>
  .missing {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  p {
    margin: 0;
    color: var(--error);
    font-size: var(--font-sm);
    line-height: 1.5;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
