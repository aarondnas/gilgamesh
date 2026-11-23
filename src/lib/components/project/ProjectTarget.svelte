<script lang="ts" module>
  /** The folder a new project goes into, `""` while name or location is missing. */
  export function targetPath(location: string, name: string) {
    const sep = location.includes("\\") ? "\\" : "/";
    return name.trim() && location ? `${location.replace(/[\\/]+$/, "")}${sep}${name.trim()}` : "";
  }
</script>

<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import { m } from "$lib/paraglide/messages";
  import { settings } from "$lib/state/settings.svelte";
  import Button from "../ui/Button.svelte";

  interface Props {
    name: string;
    location: string;
    inNewWindow: boolean;
    disabled?: boolean;
  }

  /** Name, location and window of a new project: shared by the "New" page and the import dialog. */
  let { name = $bindable(), location = $bindable(), inNewWindow = $bindable(), disabled = false }: Props = $props();

  const preview = $derived(targetPath(location, name));

  onMount(async () => {
    location ||= settings.data.projectLocation ?? ((await api.projectDefaultLocation().catch(() => null)) || "");
  });

  async function chooseLocation() {
    const dir = await open({ directory: true, defaultPath: location || undefined, title: m.project_dialog_new() });
    if (dir) location = dir;
  }
</script>

<label class="field">
  <span>{m.new_project_name()}</span>
  <!-- svelte-ignore a11y_autofocus -->
  <input bind:value={name} placeholder={m.new_project_name_placeholder()} autofocus {disabled} />
</label>

<label class="field">
  <span>{m.new_project_location()}</span>
  <div class="location">
    <input value={location} readonly title={location} />
    <Button onclick={chooseLocation} {disabled}>{m.new_project_change()}</Button>
  </div>
</label>

<p class="preview" title={preview}>{preview || " "}</p>

<label class="check">
  <input type="checkbox" bind:checked={inNewWindow} {disabled} />
  {m.new_project_in_new_window()}
</label>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-5);
    font-size: var(--font-sm);
    font-weight: 600;
  }

  input {
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--font-base);
    font-weight: normal;
  }

  input:focus {
    outline: none;
    border-color: var(--accent-strong);
  }

  input[readonly] {
    background: var(--surface-2);
    color: var(--text-muted);
  }

  .location {
    display: flex;
    gap: var(--space-3);
  }

  .location input {
    flex: 1;
    min-width: 0;
  }

  .preview {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-sm);
    color: var(--text-muted);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-5);
    font-size: var(--font-base);
  }

  .check input {
    margin: 0;
    padding: 0;
    accent-color: var(--accent-strong);
  }
</style>
