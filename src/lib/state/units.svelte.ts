// The unit lengths are shown and written in (cm, mm, in), and converting
// between them.

import { api } from "$lib/api";
import { settings } from "./settings.svelte";

/** The unit lengths are shown and written in, e.g. the page margins. */
export type Unit = "cm" | "mm" | "in";

export const UNITS: Unit[] = ["cm", "mm", "in"];

/** Centimetres per unit. */
const CM_PER: Record<Unit, number> = { cm: 1, mm: 0.1, in: 2.54 };

/** Decimals worth showing: a tenth of a millimetre at most. */
const DECIMALS: Record<Unit, number> = { cm: 2, mm: 1, in: 2 };

/** A step of the number fields. */
export const STEP: Record<Unit, number> = { cm: 0.1, mm: 1, in: 0.05 };

export function isUnit(value: unknown): value is Unit {
  return typeof value === "string" && (UNITS as string[]).includes(value);
}

/** `cm` in `unit`, rounded to what is worth showing. */
export function fromCm(cm: number, unit: Unit): number {
  const factor = 10 ** DECIMALS[unit];
  return Math.round((cm / CM_PER[unit]) * factor) / factor;
}

export function toCm(value: number, unit: Unit): number {
  return value * CM_PER[unit];
}

/** Countries that measure in inches: the US, Liberia and Myanmar. */
const IMPERIAL_REGIONS = new Set(["US", "LR", "MM"]);

/**
 * The region of a language tag ("en" → "US", "de-AT" → "AT"); `null` for one
 * Intl rejects, such as the "c" WebKitGTK reports under Linux's C locale.
 */
export function regionOf(tag: string): string | null {
  try {
    return new Intl.Locale(tag).maximize().region ?? null;
  } catch {
    return null;
  }
}

/**
 * The unit for lengths. Without a choice of the user's it follows the
 * measurement system of the system's region settings (metric: cm, US: inches;
 * on Linux the locale's), as the language follows the system's language;
 * where it cannot be read, the language's region.
 */
class UnitStore {
  /** Until the backend has answered: by the region of the browser language ("en-US"). */
  system = $state<Unit>(IMPERIAL_REGIONS.has(regionOf(navigator.language) ?? "") ? "in" : "cm");
  /** The user's choice from the settings file, `null` to follow the system. */
  preference = $derived<Unit | null>(isUnit(settings.data.unit) ? settings.data.unit : null);
  current = $derived(this.preference ?? this.system);

  constructor() {
    void api
      .systemMeasurement()
      .then((system) => {
        if (system) this.system = system === "us" ? "in" : "cm";
      })
      .catch(() => {});
  }

  set(preference: Unit | null) {
    settings.update({ unit: preference });
  }
}

export const units = new UnitStore();
