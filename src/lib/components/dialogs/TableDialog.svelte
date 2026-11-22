<script lang="ts">
  import { errorMessage } from "$lib/api";
  import { labelFrom, uniqueLabel } from "$lib/latex/preamble";
  import type { TableStyle } from "$lib/latex/tables";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { inserting } from "$lib/state/inserting.svelte";
  import { project } from "$lib/state/project.svelte";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";

  const MAX_COLUMNS = 20;
  const MAX_ROWS = 100;

  let columns = $state(3);
  let rows = $state(3);
  let header = $state(true);
  let style = $state<TableStyle>("booktabs");
  let fullWidth = $state(false);
  let caption = $state("");
  let label = $state("");
  /** The label follows the caption until the user types one of their own. */
  let labelTouched = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);

  const valid = $derived(
    Number.isInteger(columns) && columns >= 1 && columns <= MAX_COLUMNS && Number.isInteger(rows) && rows >= 1 && rows <= MAX_ROWS,
  );

  function show() {
    caption = "";
    labelTouched = false;
    label = "";
    error = null;
    void suggestLabel();
  }

  /**
   * The word for table with the number LaTeX will give this table (`tab:tabelle3`,
   * `tab:tabelle2.1` with chapters); never one the project uses already.
   */
  async function suggestLabel() {
    const number = await inserting.tableNumberAtCursor().catch(() => "1");
    if (labelTouched || !doc.tableDialog) return;
    const taken = (project.scan?.labels ?? []).map((l) => l.key);
    label = uniqueLabel(`${labelFrom("tab", m.ribbon_table(), "table")}${number}`, taken);
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !valid) return;
    busy = true;
    error = null;
    try {
      await inserting.insertTable({
        columns,
        rows,
        header,
        style,
        fullWidth,
        caption,
        label,
        headerText: (column) => m.table_column({ number: column }),
      });
      doc.tableDialog = false;
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog open={doc.tableDialog} width={480} onopen={show} onclose={() => (doc.tableDialog = false)}>
  <form onsubmit={submit}>
    <h1>{m.table_dialog_title()}</h1>

    <div class="size">
      <label class="field">
        <span>{m.table_columns()}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input type="number" min="1" max={MAX_COLUMNS} step="1" bind:value={columns} autofocus disabled={busy} />
      </label>
      <label class="field">
        <span>{m.table_rows()}</span>
        <input type="number" min="1" max={MAX_ROWS} step="1" bind:value={rows} disabled={busy} />
      </label>
    </div>

    <label class="check">
      <input type="checkbox" bind:checked={header} disabled={busy} />
      {m.table_header()}
    </label>

    <label class="field">
      <span>{m.table_style()}</span>
      <select bind:value={style} disabled={busy}>
        <option value="booktabs">{m.table_style_booktabs()}</option>
        <option value="grid">{m.table_style_grid()}</option>
      </select>
    </label>

    <label class="check">
      <input type="checkbox" bind:checked={fullWidth} disabled={busy} />
      {m.table_full_width()}
    </label>

    <label class="field">
      <span>{m.table_caption()}</span>
      <input bind:value={caption} disabled={busy} />
    </label>

    <label class="field">
      <span>{m.table_label()}</span>
      <input bind:value={label} oninput={() => (labelTouched = true)} disabled={busy} />
    </label>

    <p class="hint">{m.table_hint({ file: project.file ?? "" })}</p>
    {#if error}<p class="error">{error}</p>{/if}

    <footer>
      <Button onclick={() => (doc.tableDialog = false)} disabled={busy}>{m.new_project_cancel()}</Button>
      <Button type="submit" variant="primary" disabled={busy || !valid}>{m.table_submit()}</Button>
    </footer>
  </form>
</Dialog>

<style>
  .size {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-5);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
    font-size: var(--font-base);
  }

  .check input {
    margin: 0;
    accent-color: var(--accent-strong);
  }
</style>
