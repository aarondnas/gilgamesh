<script lang="ts">
  import { m } from "$lib/paraglide/messages";

  interface Props {
    /** Current zoom, 1 = 100 %. */
    value: number;
    /** Limits as factors, e.g. 0.5 and 2.5. */
    min: number;
    max: number;
    /** Receives the typed zoom as a factor, already limited to min…max. */
    onchange: (value: number) => void;
  }

  let { value, min, max, onchange }: Props = $props();

  const STEP = 10;

  let input: HTMLInputElement;
  let editing = $state(false);
  let draft = $state("");

  const percent = $derived(Math.round(value * 100));
  const shown = $derived(editing ? draft : m.pdf_zoom_level({ percent }));

  function start() {
    editing = true;
    draft = String(percent);
    // After the value switched to the bare number.
    queueMicrotask(() => input.select());
  }

  /** Accepts "125", "125 %", "125,5"; anything else keeps the old value. */
  function commit() {
    if (!editing) return;
    editing = false;
    const typed = parseFloat(draft.replace(",", ".").replace(/[%\s]/g, ""));
    if (!Number.isFinite(typed)) return;
    const clamped = Math.min(Math.max(typed / 100, min), max);
    if (Math.round(clamped * 100) !== percent) onchange(Math.round(clamped * 100) / 100);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      commit();
      input.blur();
    } else if (event.key === "Escape") {
      editing = false;
      input.blur();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const current = parseFloat(draft.replace(",", ".")) || percent;
      draft = String(Math.round(current + (event.key === "ArrowUp" ? STEP : -STEP)));
      queueMicrotask(() => input.select());
    } else {
      return;
    }
    event.preventDefault();
  }
</script>

<input
  bind:this={input}
  class="zoom-input"
  type="text"
  inputmode="decimal"
  spellcheck="false"
  title={m.zoom_input_title({ min: Math.round(min * 100), max: Math.round(max * 100) })}
  aria-label={m.zoom_input_title({ min: Math.round(min * 100), max: Math.round(max * 100) })}
  value={shown}
  onfocus={start}
  oninput={(e) => (draft = e.currentTarget.value)}
  onblur={commit}
  onkeydown={onKeyDown}
/>

<style>
  .zoom-input {
    width: 56px;
    padding: var(--space-1) var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--font-sm);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .zoom-input:hover {
    border-color: var(--border);
    background: var(--hover);
  }

  .zoom-input:focus {
    border-color: var(--accent-strong);
    background: var(--surface);
    outline: none;
  }
</style>
