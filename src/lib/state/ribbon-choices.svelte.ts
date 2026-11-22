// Choices a ribbon tab offers beside its buttons, such as what a click on an
// alignment button acts on. They last while their tab is shown: leaving it in
// any way (another tab, the "File" tab) puts them back to their default, so
// the tab always opens as expected. A new one is made with `ribbonChoice`.
//
// The default is the user's where they set one (`setDefault`, kept in the
// settings under the choice's key), else the one the app comes with.

import type { Tab } from "./document.svelte";
import { settings } from "./settings.svelte";

export class RibbonChoice<T extends string> {
  /** What the user chose while the tab is shown; `null` for the default. */
  #chosen = $state<T | null>(null);

  constructor(
    readonly tab: Tab,
    /** Where the user's default is kept in `settings.data.ribbonDefaults`. */
    readonly key: string,
    readonly builtIn: T,
    /** The values a default may take; one stored by another version is ignored where it no longer is one. */
    readonly allowed: readonly T[],
  ) {}

  get value(): T {
    return this.#chosen ?? this.fallback;
  }

  set value(value: T) {
    this.#chosen = value;
  }

  /** What the choice starts as and falls back to. */
  get fallback(): T {
    const stored = settings.data.ribbonDefaults[this.key] as T | undefined;
    return stored !== undefined && this.allowed.includes(stored) ? stored : this.builtIn;
  }

  /** Makes `value` the default, for this and every later session. */
  setDefault(value: T) {
    settings.update({ ribbonDefaults: { ...settings.data.ribbonDefaults, [this.key]: value } });
  }

  reset() {
    this.#chosen = null;
  }
}

const choices: RibbonChoice<string>[] = [];

/** A choice of `tab` among `allowed`, kept as `key`, that starts as, and falls back to, its default (`builtIn` unless the user set one). */
export function ribbonChoice<T extends string>(tab: Tab, key: string, builtIn: T, allowed: readonly T[]): RibbonChoice<T> {
  const choice = new RibbonChoice(tab, key, builtIn, allowed);
  choices.push(choice as unknown as RibbonChoice<string>);
  return choice;
}

/** Puts the choices of `tab` back to their defaults, as it is left. */
export function leaveTab(tab: Tab) {
  for (const choice of choices) if (choice.tab === tab) choice.reset();
}
