<!--
  New versions of Gilgamesh (src-tauri/src/updates.rs): the version running, what the last check
  found with the way to install it, "Check now" and the daily check (`Settings.checkUpdates`).
-->
<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { m } from "$lib/paraglide/messages";
  import { getLocale } from "$lib/paraglide/runtime";
  import { settings } from "$lib/state/settings.svelte";
  import { updates } from "$lib/state/updates.svelte";
  import Button from "../ui/Button.svelte";

  const status = $derived(updates.status);

  /** "5 minutes ago", in the UI's language. */
  function ago(at: number): string {
    const format = new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto" });
    const minutes = Math.round((at - Date.now()) / 60_000);
    if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return format.format(hours, "hour");
    return format.format(Math.round(hours / 24), "day");
  }
</script>

<section>
  <h1>{m.settings_updates_title()}</h1>
  <p>{m.settings_updates_text()}</p>

  <div class="card">
    <div class="state">
      <h2>{m.settings_updates_current({ version: status?.current ?? "…" })}</h2>
      {#if status?.installing}
        <p>
          {updates.percent != null ? m.update_downloading({ percent: updates.percent }) : m.update_downloading_unknown()}
        </p>
      {:else if status?.checking}
        <p>{m.settings_updates_checking()}</p>
      {:else if updates.error}
        <p class="error">{updates.error}</p>
      {:else if status?.available}
        <p class="new">{m.settings_updates_available({ version: status.available.version })}</p>
      {:else if status?.checkedAt}
        <p class="ok"><Check size={14} /> {m.settings_updates_up_to_date({ time: ago(status.checkedAt) })}</p>
      {:else}
        <p>{m.settings_updates_never()}</p>
      {/if}
    </div>

    <div class="actions">
      {#if updates.available && !status?.installing}
        {#if status?.canInstall}
          <Button variant="primary" size="md" onclick={() => void updates.install()}>{m.update_install()}</Button>
        {:else}
          <Button variant="primary" size="md" onclick={() => updates.openWebsite()}>{m.settings_updates_download()}</Button>
        {/if}
      {/if}
      <Button variant="outline" size="md" disabled={!status || status.checking || status.installing} onclick={() => void updates.check()}>
        {m.settings_updates_check()}
      </Button>
    </div>

    {#if status?.available?.notes && status.lost !== "untrusted"}
      <h3>{m.settings_updates_notes()}</h3>
      <pre class="notes">{status.available.notes}</pre>
    {/if}
    {#if status && !status.canInstall}
      <p class="hint">{m.settings_updates_manual()}</p>
    {/if}
  </div>

  <!-- Updates no longer come this way: the website has the new version. -->
  {#if status?.lost}
    <div class="lost">
      <TriangleAlert size={16} />
      <span>{status.lost === "missing" ? m.settings_updates_lost_missing() : m.settings_updates_lost_untrusted()}</span>
      <Button variant="outline" size="md" onclick={() => updates.openWebsite()}>{m.settings_updates_website()}</Button>
    </div>
  {/if}

  <label class="auto">
    <input
      type="checkbox"
      checked={settings.data.checkUpdates}
      onchange={(e) => settings.update({ checkUpdates: e.currentTarget.checked })}
    />
    <span>
      {m.settings_updates_auto()}
      <small>{m.settings_updates_auto_text()}</small>
    </span>
  </label>
</section>

<style>
  h2 {
    margin: 0;
    font-size: var(--font-base);
    font-weight: 600;
  }

  h3 {
    margin: 0;
    font-size: var(--font-sm);
    font-weight: 600;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-top: var(--space-6);
    padding: var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }

  .card p {
    margin: 0;
  }

  .state {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  .ok {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .new {
    color: var(--text);
    font-weight: 600;
  }

  .error {
    color: var(--error);
  }

  .hint {
    font-size: var(--font-sm);
  }

  .notes {
    max-height: 240px;
    margin: 0;
    padding: var(--space-4) var(--space-5);
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    font-family: inherit;
    font-size: var(--font-sm);
    white-space: pre-wrap;
  }

  .lost {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin-top: var(--space-5);
    padding: var(--space-4) var(--space-5);
    border: 1px solid var(--warning);
    border-radius: var(--radius-lg);
    color: var(--text);
  }

  .lost :global(svg) {
    color: var(--warning);
  }

  .lost span {
    flex: 1;
    min-width: 220px;
  }

  .auto {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
    margin-top: var(--space-6);
  }

  .auto input {
    margin-top: 3px;
  }

  .auto span {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .auto small {
    color: var(--text-muted);
    font-size: var(--font-sm);
  }
</style>
