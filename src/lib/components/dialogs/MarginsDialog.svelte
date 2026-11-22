<script lang="ts">
  import { errorMessage } from "$lib/api";
  import { MARGIN_PRESETS, type MarginPreset, type Margins, type PageLayout } from "$lib/latex/margins";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { pageLayout } from "$lib/state/page-layout.svelte";
  import { locale } from "$lib/state/locale.svelte";
  import { fromCm, STEP, toCm, units, type Unit } from "$lib/state/units.svelte";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";
  import PagePreview from "./PagePreview.svelte";

  type Side = keyof Margins;

  /** `null` where the document's margins cannot be set (beamer, no preamble). */
  let layout = $state<PageLayout | null>(null);
  /** The unit the fields show and the preamble gets: the one set when the dialog opened. */
  let unit = $state<Unit>("cm");
  /** In `unit`. */
  let margins = $state<Margins>({ ...MARGIN_PRESETS.metric.normal });
  /** The class decides the margins so far: geometry is not given any. */
  let classDefault = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);

  const presetNames: Record<MarginPreset, () => string> = {
    normal: m.margins_preset_normal,
    narrow: m.margins_preset_narrow,
    moderate: m.margins_preset_moderate,
    wide: m.margins_preset_wide,
  };
  const presets = Object.keys(MARGIN_PRESETS.metric) as MarginPreset[];
  const sides: Side[] = ["top", "bottom", "left", "right"];

  /** A preset in `unit`: in inches as Word has it, else in round centimetres (or their millimetres). */
  function preset(name: MarginPreset, unit: Unit): Margins {
    if (unit === "in") return { ...MARGIN_PRESETS.imperial[name] };
    const factor = unit === "mm" ? 10 : 1;
    const cm = MARGIN_PRESETS.metric[name];
    return { top: cm.top * factor, bottom: cm.bottom * factor, left: cm.left * factor, right: cm.right * factor };
  }

  function inCm(values: Margins): Margins {
    return {
      top: toCm(values.top, unit),
      bottom: toCm(values.bottom, unit),
      left: toCm(values.left, unit),
      right: toCm(values.right, unit),
    };
  }

  const sideNames = $derived<Record<Side, string>>({
    top: m.margins_top(),
    bottom: m.margins_bottom(),
    left: layout?.twoSided ? m.margins_inner() : m.margins_left(),
    right: layout?.twoSided ? m.margins_outer() : m.margins_right(),
  });

  const paper = $derived(layout?.paper ?? { width: 21, height: 29.7 });
  const chosenPreset = $derived(presets.find((p) => sides.every((s) => preset(p, unit)[s] === margins[s])) ?? null);
  const valid = $derived(sides.every((s) => typeof margins[s] === "number" && margins[s] >= 0));
  /** At least a centimetre of text area left in both directions. */
  const fits = $derived.by(() => {
    if (!valid) return true;
    const cm = inCm(margins);
    return cm.left + cm.right <= paper.width - 1 && cm.top + cm.bottom <= paper.height - 1;
  });
  const ready = $derived(!!layout && valid && fits);

  const number = $derived(new Intl.NumberFormat(locale.current, { maximumFractionDigits: 2 }));

  async function show() {
    error = null;
    busy = false;
    try {
      layout = await pageLayout.read();
    } catch (err) {
      layout = null;
      error = errorMessage(err);
    }
    if (!doc.marginsDialog) return;
    unit = units.current;
    const given = layout?.margins;
    classDefault = !!layout && sides.every((s) => given?.[s] === null);
    // Sides geometry is not given a plain length for start from the normal margins.
    const normal = preset("normal", unit);
    margins = Object.fromEntries(sides.map((s) => [s, given?.[s] == null ? normal[s] : fromCm(given[s], unit)])) as unknown as Margins;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    busy = true;
    error = null;
    try {
      await pageLayout.setMargins($state.snapshot(margins), unit);
      doc.marginsDialog = false;
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog open={doc.marginsDialog} width={560} onopen={show} onclose={() => (doc.marginsDialog = false)}>
  <form onsubmit={submit}>
    <h1>{m.margins_title()}</h1>

    {#if layout}
      <div class="presets" role="radiogroup" aria-label={m.margins_title()}>
        {#each presets as name (name)}
          {@const values = preset(name, unit)}
          <button
            type="button"
            role="radio"
            aria-checked={chosenPreset === name}
            class:selected={chosenPreset === name}
            disabled={busy}
            onclick={() => (margins = values)}
          >
            <PagePreview {paper} margins={inCm(values)} width={34} />
            <span class="name">{presetNames[name]()}</span>
            <span class="values">
              {values.top === values.left
                ? `${number.format(values.top)} ${unit}`
                : `${number.format(values.top)} / ${number.format(values.left)} ${unit}`}
            </span>
          </button>
        {/each}
      </div>

      <div class="custom">
        <fieldset>
          <legend>{m.margins_custom()}</legend>
          {#each sides as side (side)}
            <label>
              <span>{sideNames[side]}</span>
              <span class="input">
                <input type="number" min="0" step={STEP[unit]} bind:value={margins[side]} disabled={busy} />
                <span class="unit">{unit}</span>
              </span>
            </label>
          {/each}
        </fieldset>
        <div class="preview" aria-hidden="true">
          <PagePreview {paper} margins={valid ? inCm(margins) : margins} width={120} />
        </div>
      </div>

      {#if layout.twoSided}<p class="hint">{m.margins_two_sided()}</p>{/if}
      {#if classDefault}<p class="hint">{m.margins_class_default()}</p>{/if}
      {#if !fits}<p class="error">{m.margins_too_large()}</p>{/if}
    {:else if !error}
      <p class="hint">{m.margins_unsupported()}</p>
    {/if}

    {#if error}<p class="error">{error}</p>{/if}

    <footer>
      <Button onclick={() => (doc.marginsDialog = false)} disabled={busy}>{m.new_project_cancel()}</Button>
      <Button type="submit" variant="primary" disabled={busy || !ready}>{m.margins_submit()}</Button>
    </footer>
  </form>
</Dialog>

<style>
  .presets {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-6);
  }

  .presets button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }

  .presets button:hover:not(:disabled) {
    background: var(--hover);
  }

  .presets button.selected {
    border-color: var(--accent-strong);
    background: var(--hover);
    box-shadow: inset 0 0 0 1px var(--accent-strong);
  }

  .name {
    font-size: var(--font-sm);
    font-weight: 600;
  }

  .values {
    color: var(--text-muted);
    font-size: var(--font-xs);
    font-variant-numeric: tabular-nums;
  }

  .custom {
    display: flex;
    align-items: center;
    gap: var(--space-7);
  }

  fieldset {
    display: grid;
    grid-template-columns: auto auto;
    align-items: center;
    gap: var(--space-3) var(--space-5);
    flex: 1;
    margin: 0;
    padding: 0;
    border: none;
  }

  legend {
    margin-bottom: var(--space-4);
    padding: 0;
    font-size: var(--font-sm);
    font-weight: 600;
  }

  label {
    display: contents;
    font-size: var(--font-sm);
  }

  .input {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  input {
    width: 88px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--font-base);
    font-variant-numeric: tabular-nums;
  }

  input:focus {
    outline: none;
    border-color: var(--accent-strong);
  }

  .unit {
    color: var(--text-muted);
    font-size: var(--font-sm);
  }

  .preview {
    display: flex;
    justify-content: center;
    width: 180px;
  }

  .hint {
    margin: var(--space-5) 0 0;
    color: var(--text-muted);
    font-size: var(--font-sm);
  }

  .error {
    margin: var(--space-4) 0 0;
    color: var(--error);
    font-size: var(--font-sm);
  }
</style>
