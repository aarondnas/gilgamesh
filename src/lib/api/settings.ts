// The installation-wide settings (src-tauri/src/commands/settings.rs).
import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "$lib/state/settings.svelte";

export const settingsApi = {
  /** `null` before the first save. */
  settingsLoad: () => invoke<Settings | null>("settings_load"),
  settingsSave: (settings: Settings) => invoke<void>("settings_save", { settings }),
  /** The measurement system of the system's region settings; `null` where it cannot be read. */
  systemMeasurement: () => invoke<"metric" | "us" | null>("system_measurement"),
};
