// The installation-wide settings (settings.json, read and written by the
// backend), kept in step with the other windows.

import { api, events } from "$lib/api";

/** Where a pane is shown: in the main window, in a window of its own, or not at all. */
export type PaneMode = "docked" | "detached" | "closed";
export type PaneId = "editor" | "pdf";

/** Position and inner size of a detached pane's window, in logical pixels. */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaneLayout {
  editor: PaneMode;
  pdf: PaneMode;
  /** Where each pane's window (and the last file window, `tab`) was last, so it reopens there. */
  bounds: Partial<Record<string, WindowBounds>>;
}

/** Installation-wide settings, stored by the backend in `settings.json` in the app's config folder. */
export interface Settings {
  /** UI language ("de", "en"); `null` follows the system. */
  locale: string | null;
  /** Most recently opened first. */
  recentProjects: string[];
  /** Folder the "new project" dialog suggests. */
  projectLocation: string | null;
  /** Install missing packages from TeX Live without asking; only once the user said so (`autoInstallAsked`). */
  autoInstallPackages: boolean;
  /** Whether the user decided on `autoInstallPackages`, by the offer after setup or by the checkbox. */
  autoInstallAsked: boolean;
  /** Fetch previews of fonts not installed from the TeX Live server in the font manager; only once the user said so (`fontPreviewsAsked`). */
  fontPreviewDownloads: boolean;
  /** Whether the user decided on `fontPreviewDownloads`. */
  fontPreviewsAsked: boolean;
  /** Write edits shortly after typing; off, only explicit saves (Ctrl+S) and actions that need the files on disk write them. */
  autoSave: boolean;
  sidebarCollapsed: boolean;
  /** Width of the project explorer in pixels; `null` is its full width. */
  sidebarWidth: number | null;
  /** Text size in the editor; 1 is the normal size. */
  editorZoom: number;
  /** Look for a new version of Gilgamesh once a day (see `updates.svelte.ts`). */
  checkUpdates: boolean;
  /** Light or dark; "system" follows Windows. */
  theme: ThemeSetting;
  /** Unit of lengths ("cm", "mm", "in"); `null` follows the measurement system of the region settings. */
  unit: string | null;
  panes: PaneLayout;
  /** Whether the problems panel shows under the editor when there are problems; hidden, the status bar still counts them. */
  problemsPanel: boolean;
  /** The defaults the user set for choices beside the ribbon's buttons, by their key (see `ribbon-choices.svelte.ts`). */
  ribbonDefaults: Record<string, string>;
  /** The characters last inserted from the symbol dialog, most recent first. */
  recentSymbols: string[];
}

export type ThemeSetting = "system" | "light" | "dark";

const DEFAULTS: Settings = {
  locale: null,
  recentProjects: [],
  projectLocation: null,
  autoInstallPackages: false,
  autoInstallAsked: false,
  fontPreviewDownloads: false,
  fontPreviewsAsked: false,
  autoSave: true,
  sidebarCollapsed: false,
  sidebarWidth: null,
  editorZoom: 1,
  checkUpdates: true,
  theme: "system",
  unit: null,
  panes: { editor: "docked", pdf: "docked", bounds: {} },
  problemsPanel: true,
  ribbonDefaults: {},
  recentSymbols: [],
};

/** Where versions before `settings.json` kept these values (the webview's localStorage). */
const LEGACY_KEYS = {
  locale: "PARAGLIDE_LOCALE",
  recentProjects: "gilgamesh.recentProjects",
  projectLocation: "gilgamesh.projectLocation",
  autoInstallPackages: "gilgamesh.autoInstallPackages",
  sidebarCollapsed: "gilgamesh.sidebarCollapsed",
} as const;

function readLegacy(): Partial<Settings> {
  const read = (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const legacy: Partial<Settings> = {};
  const locale = read(LEGACY_KEYS.locale);
  if (locale) legacy.locale = locale;
  try {
    const recent: unknown = JSON.parse(read(LEGACY_KEYS.recentProjects) ?? "null");
    if (Array.isArray(recent)) legacy.recentProjects = recent.filter((r) => typeof r === "string");
  } catch {
    // Unreadable: start without recent projects.
  }
  const location = read(LEGACY_KEYS.projectLocation);
  if (location) legacy.projectLocation = location;
  const autoInstall = read(LEGACY_KEYS.autoInstallPackages);
  if (autoInstall !== null) legacy.autoInstallPackages = autoInstall !== "false";
  const collapsed = read(LEGACY_KEYS.sidebarCollapsed);
  if (collapsed !== null) legacy.sidebarCollapsed = collapsed === "true";
  return legacy;
}

function clearLegacy() {
  try {
    for (const key of Object.values(LEGACY_KEYS)) localStorage.removeItem(key);
  } catch {
    // Nothing to clean up.
  }
}

class SettingsStore {
  data = $state<Settings>({ ...DEFAULTS });
  loaded = $state(false);
  #saving: Promise<void> = Promise.resolve();

  /** Must finish before the UI renders, so the language is right from the first frame. */
  async load() {
    try {
      const stored = await api.settingsLoad();
      if (stored) {
        this.data = { ...DEFAULTS, ...stored, panes: { ...DEFAULTS.panes, ...stored.panes } };
      } else {
        // First start with settings.json: take over what older versions stored.
        this.data = { ...DEFAULTS, ...readLegacy() };
        await this.#save();
        clearLegacy();
      }
    } catch {
      // Without the backend (or a broken file) the defaults still work.
    }
    this.loaded = true;
    // Another window or program changed the file: take its values over.
    void events.onSettingsChanged(() => void this.#reload());
  }

  async #reload() {
    const stored = await api.settingsLoad().catch(() => null);
    if (stored) this.data = { ...DEFAULTS, ...stored, panes: { ...DEFAULTS.panes, ...stored.panes } };
  }

  /** Changes some settings and writes the file; writes never overtake each other. */
  update(changes: Partial<Settings>) {
    Object.assign(this.data, changes);
    void this.#save().catch(() => {});
  }

  #save(): Promise<void> {
    const snapshot = $state.snapshot(this.data);
    this.#saving = this.#saving.catch(() => {}).then(() => api.settingsSave(snapshot));
    return this.#saving;
  }
}

export const settings = new SettingsStore();
