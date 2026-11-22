<script lang="ts" module>
  import { api } from "$lib/api";

  /** Name and e-mail for commits, as typed into the form. */
  export interface Identity {
    name: string;
    email: string;
  }

  /** What to ask for before the first commit: `null` if Git knows who commits. Fails without Git. */
  export async function missingIdentity(): Promise<Identity | null> {
    const current = await api.gitIdentity();
    return !current.name || !current.email ? { name: current.name ?? "", email: current.email ?? "" } : null;
  }

  export function identityValid(identity: Identity | null): boolean {
    return !identity || (identity.name.trim() !== "" && identity.email.includes("@"));
  }
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages";

  interface Props {
    identity: Identity;
    disabled?: boolean;
  }

  let { identity = $bindable(), disabled = false }: Props = $props();
</script>

<!-- Asked for only when Git has no name and e-mail yet (a fresh installation). -->
<fieldset class="identity">
  <legend>{m.git_identity_title()}</legend>
  <p class="hint">{m.git_identity_text()}</p>
  <label class="field">
    <span>{m.git_identity_name()}</span>
    <input bind:value={identity.name} autocomplete="name" {disabled} />
  </label>
  <label class="field">
    <span>{m.git_identity_email()}</span>
    <input type="email" bind:value={identity.email} autocomplete="email" {disabled} />
  </label>
</fieldset>

<style>
  .identity {
    margin: 0 0 var(--space-5);
    padding: var(--space-4) var(--space-5) 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .identity:last-child {
    margin-bottom: 0;
  }

  legend {
    padding: 0 var(--space-2);
    font-size: var(--font-sm);
    font-weight: 600;
  }

  .hint {
    margin: 0 0 var(--space-4);
  }
</style>
