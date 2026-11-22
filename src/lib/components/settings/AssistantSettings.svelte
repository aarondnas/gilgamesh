<script lang="ts">
  import { onMount } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import Check from "@lucide/svelte/icons/check";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { api, errorMessage, type AssistantStatus, type AssistantsStatus } from "$lib/api";
  import { m } from "$lib/paraglide/messages";
  import Button from "../ui/Button.svelte";
  import SettingsPage from "./SettingsPage.svelte";

  const DOWNLOAD_URL = "https://claude.ai/download";
  const CODEX_URL = "https://openai.com/codex";

  type Which = "desktop" | "code" | "codex";

  let status = $state<AssistantsStatus | null>(null);
  let busy = $state<Which | null>(null);
  /** What to do next, or what went wrong, per assistant. */
  let notes = $state<Partial<Record<Which, string>>>({});
  let errors = $state<Partial<Record<Which, string>>>({});

  async function refresh() {
    status = await api.assistantStatus().catch(() => null);
  }

  onMount(refresh);

  async function connect(which: Which) {
    busy = which;
    notes[which] = errors[which] = undefined;
    try {
      if (which === "desktop") {
        const how = await api.assistantConnectDesktop();
        notes.desktop = how === "extension" ? m.assistant_confirm_install() : m.assistant_restart_desktop();
      } else if (which === "code") {
        await api.assistantConnectCode();
        notes.code = m.assistant_code_done();
      } else {
        await api.assistantConnectCodex();
        notes.codex = m.assistant_codex_done();
      }
      await refresh();
    } catch (err) {
      errors[which] = errorMessage(err);
    } finally {
      busy = null;
    }
  }
</script>

{#snippet assistant(which: Which, name: string, state: AssistantStatus, label: string)}
  <div class="card">
    <div class="head">
      <h2>{name}</h2>
      {#if state.outdated}
        <span class="outdated"><TriangleAlert size={14} /> {m.assistant_outdated()}</span>
      {:else if state.connected}
        <span class="connected"><Check size={14} /> {m.assistant_connected()}</span>
      {/if}
    </div>
    <Button
      variant={state.connected && !state.outdated ? "outline" : "primary"}
      size="md"
      disabled={busy !== null}
      onclick={() => connect(which)}
    >
      {state.connected ? m.assistant_reconnect() : label}
    </Button>
    {#if notes[which]}<p class="note">{notes[which]}</p>{/if}
    {#if errors[which]}<p class="error">{errors[which]}</p>{/if}
  </div>
{/snippet}

<!-- Back from Claude or Codex, where an entry may have been removed: read the state anew. -->
<svelte:window onfocus={refresh} />

<SettingsPage>
  <section>
    <h1>Claude</h1>
    <p>{m.assistant_text()}</p>

    {#if status && !status.running}
      <p class="error">{m.assistant_not_running()}</p>
    {:else if status}
      <div class="cards">
        {#if status.desktop.installed}
          {@render assistant("desktop", "Claude Desktop", status.desktop, m.assistant_connect_desktop())}
        {:else}
          <div class="card">
            <h2>Claude Desktop</h2>
            <p>{m.assistant_desktop_missing()}</p>
            <Button variant="primary" size="md" onclick={() => openUrl(DOWNLOAD_URL)}>{m.assistant_download()}</Button>
          </div>
        {/if}

        {#if status.code.installed}
          {@render assistant("code", "Claude Code", status.code, m.assistant_connect_code())}
        {/if}
      </div>
    {/if}
  </section>

  {#if status?.running}
    <section>
      <h1>OpenAI</h1>
      <p>{m.assistant_openai_text()}</p>

      {#if status.codex.installed}
        {@render assistant("codex", "Codex", status.codex, m.assistant_connect_codex())}
      {:else}
        <div class="card">
          <h2>Codex</h2>
          <p>{m.assistant_codex_missing()}</p>
          <Button variant="primary" size="md" onclick={() => openUrl(CODEX_URL)}>{m.assistant_codex_download()}</Button>
        </div>
      {/if}
    </section>
  {/if}
</SettingsPage>

<style>
  h2 {
    margin: 0;
    font-size: var(--font-base);
    font-weight: 600;
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
    margin-top: var(--space-6);
    padding: var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }

  /* Side by side while both fit, one below the other in a narrow window. */
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-5);
    margin-top: var(--space-6);
  }

  .cards .card {
    margin-top: 0;
  }

  .card p {
    margin: 0;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-5);
  }

  .connected,
  .outdated {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--success);
    font-size: var(--font-sm);
  }

  .outdated {
    color: var(--warning);
  }

  .note {
    color: var(--text);
  }

  .error {
    color: var(--error);
  }
</style>
