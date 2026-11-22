// How large an image or PDF in a tab is shown: fitted into its pane, or at a
// factor. Each view has its own; nothing of it is remembered.

export const MIN_IMAGE_ZOOM = 0.1;
export const MAX_IMAGE_ZOOM = 8;
/** One step of the buttons, Ctrl+Plus/Minus and a mouse wheel notch. */
const STEP = 1.25;

export class ImageZoom {
  /** `null`: as large as the pane allows (for an image never beyond its own size). */
  factor = $state<number | null>(null);
  /** The factor fitting shows the file at; reported by the view (1 for a PDF, whose zoom counts from fitting). */
  fit = $state(1);
  value = $derived(this.factor ?? this.fit);
  /** Limits, set by the view: an image's or the PDF renderer's. */
  min = $state(MIN_IMAGE_ZOOM);
  max = $state(MAX_IMAGE_ZOOM);

  /** To `value`, limited and rounded to whole percent. */
  set(value: number) {
    this.factor = Math.min(Math.max(Math.round(value * 100) / 100, this.min), this.max);
  }

  step(out: boolean) {
    this.set(out ? this.value / STEP : this.value * STEP);
  }

  /** Back to fitting the pane. */
  reset() {
    this.factor = null;
  }
}
