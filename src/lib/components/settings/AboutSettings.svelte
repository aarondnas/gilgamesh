<script lang="ts">
  import { getVersion } from "@tauri-apps/api/app";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import { m } from "$lib/paraglide/messages";
  import Button from "../ui/Button.svelte";

  const GPL_URL = "https://www.gnu.org/licenses/gpl-3.0.html";
  /** Where the GPL's corresponding source is offered. */
  const SOURCE_URL = "https://github.com/aarondnas/gilgamesh";

  let version = $state("");
  /** The licenses of what the app ships that others made (scripts/third-party-notices.mjs); `null` while loading. */
  let notices = $state<string | null>(null);

  onMount(() => {
    getVersion()
      .then((v) => (version = v))
      .catch(() => {});
    fetch("/third-party-notices.txt")
      .then((response) => (response.ok ? response.text() : ""))
      .then((text) => (notices = text))
      .catch(() => (notices = ""));
  });
</script>

<section>
  <h1>Gilgamesh</h1>
  {#if version}<p>{m.settings_about_version({ version })}</p>{/if}

  <!-- The GPL's "Appropriate Legal Notices" (section 5d); keep in step with NOTICE. -->
  <h2>{m.settings_about_license()}</h2>
  <p>Copyright © 2026 Aaron</p>
  <p>{m.settings_about_license_text()}</p>
  <p>{m.settings_about_license_names()}</p>
  <div class="links">
    <Button variant="outline" size="md" onclick={() => openUrl(GPL_URL)}>{m.settings_about_license_read()}</Button>
    <Button variant="outline" size="md" onclick={() => openUrl(SOURCE_URL)}>{m.settings_about_source()}</Button>
  </div>

  <h2>{m.settings_about_notices()}</h2>
  <p>{m.settings_about_notices_text()}</p>
  {#if notices}
    <pre class="notices">{notices}</pre>
  {:else if notices === ""}
    <p class="error">{m.settings_about_notices_missing()}</p>
  {/if}
</section>

<style>
  h2 {
    margin: var(--space-8) 0 var(--space-3);
    font-size: var(--font-md);
    font-weight: 600;
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  /* The licenses as their authors laid them out (80 columns fit); the few written
     with a whole paragraph on one line wrap, so the box only scrolls vertically. */
  .notices {
    max-height: 480px;
    margin: var(--space-4) 0 0;
    padding: var(--space-4) var(--space-5);
    overflow-x: hidden;
    overflow-y: auto;
    overflow-wrap: anywhere;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: var(--font-xs);
    line-height: 1.45;
    white-space: pre-wrap;
  }
</style>
