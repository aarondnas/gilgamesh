// Where the editor and the PDF preview are shown (docked, in windows of their
// own, or not at all), and the popup windows detached parts are rendered into.

import { mount, unmount } from "svelte";
import { availableMonitors, getCurrentWindow, Window as TauriWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import PaneFrame from "$lib/components/window/PaneFrame.svelte";
import { handleShortcut, refuseContextMenu, refuseFiles, refuseZoomIn } from "$lib/components/window/shortcuts";
import { settings, type PaneId, type PaneMode, type WindowBounds } from "./settings.svelte";

export type { PaneId, PaneMode };

export const PANES: PaneId[] = ["editor", "pdf"];

/** How often a detached window is checked for being closed or reloaded. */
const WATCH_INTERVAL = 250;
const SAVE_BOUNDS_DELAY = 500;
/** As the transition of `.panes.animating` on the main page. */
const SPLIT_ANIMATION_MS = 320;
const DEFAULT_SIZE: Record<PaneId, { width: number; height: number }> = {
  editor: { width: 800, height: 900 },
  pdf: { width: 760, height: 950 },
};

/** A window of its own, rendered by this page (see `Popups`). */
export interface PopupSpec {
  /** Letters and digits only: names the native window `pane-<key>` (see `window/mod.rs`). */
  key: string;
  /** Under which name the window's last place is remembered; windows of one kind share it. */
  boundsKey: string;
  defaultSize: { width: number; height: number };
  /** Renders the content into the window's root element. */
  render: (target: HTMLElement) => ReturnType<typeof mount>;
  /** The user closed the window with its own close button. */
  onClosed: () => void;
}

interface Popup {
  spec: PopupSpec;
  win: Window;
  /** The popup document the content is rendered into, `null` until it is ready. */
  document: Document | null;
  component: ReturnType<typeof mount> | null;
  timer?: ReturnType<typeof setInterval>;
  /** Moved/resized listeners of the native window, once it was found. */
  unlisten: UnlistenFn[] | null;
}

/**
 * Windows of their own for parts of the UI: the editor, the preview, single
 * files. Each is a `window.open` popup that this page renders into, so it
 * shares the editor, the build and all other state, as if it were still part
 * of the main window.
 */
class Popups {
  #windows = new Map<string, Popup>();
  /** Windows being opened; a second request for one waits for the first. */
  #opening = new Map<string, Promise<boolean>>();
  #saveTimer: ReturnType<typeof setTimeout> | undefined;
  #styleObserver: MutationObserver | null = null;
  #themeObserver: MutationObserver | null = null;

  /** Whether the window is open (and not just being opened). */
  has(key: string) {
    return this.#windows.has(key) && !this.#opening.has(key);
  }

  /** Opens the window; `false` if the webview refused. `at` puts its top-left corner there. */
  open(spec: PopupSpec, at?: { x: number; y: number }): Promise<boolean> {
    let opening = this.#opening.get(spec.key);
    if (!opening) {
      opening = this.#create(spec, at).finally(() => this.#opening.delete(spec.key));
      this.#opening.set(spec.key, opening);
    }
    return opening;
  }

  async focus(key: string) {
    const native = await TauriWindow.getByLabel(label(key)).catch(() => null);
    if (!native) return;
    await native.unminimize().catch(() => {});
    await native.setFocus().catch(() => {});
  }

  close(key: string) {
    const popup = this.#windows.get(key);
    if (!popup) return;
    this.#release(popup);
    popup.win.close();
    // WebView2 does not always honour `close()` for a window the host supplied
    // (see `window/mod.rs`): the page empties, the native window stays. So it is
    // also destroyed natively, unless it was opened again meanwhile and the
    // label already belongs to the new window.
    void TauriWindow.getByLabel(label(key))
      .then((native) => (this.#windows.has(key) || this.#opening.has(key) ? undefined : native?.destroy()))
      .catch(() => {});
  }

  async #create(spec: PopupSpec, at?: { x: number; y: number }): Promise<boolean> {
    if (this.#windows.has(spec.key)) return true;
    const features = ["popup", ...(await this.#placement(spec, at))];
    // The fragment names the native window (see `window/mod.rs`). Opening the same
    // name again reuses a window left over from before a reload of this page.
    const win = window.open(`about:blank#${spec.key}`, `gilgamesh-${spec.key}`, features.join(","));
    if (!win) return false;
    const popup: Popup = { spec, win, document: null, component: null, unlisten: null };
    popup.timer = setInterval(() => this.#watch(popup), WATCH_INTERVAL);
    this.#windows.set(spec.key, popup);
    this.#watch(popup);
    return true;
  }

  /** `window.open` features that put the window where it was last, if that is still on a screen. */
  async #placement(spec: PopupSpec, at?: { x: number; y: number }): Promise<string[]> {
    const saved = settings.data.panes.bounds[spec.boundsKey];
    const size = saved ?? spec.defaultSize;
    const features = [`width=${Math.round(size.width)}`, `height=${Math.round(size.height)}`];
    if (at) features.push(`left=${Math.round(at.x)}`, `top=${Math.round(at.y)}`);
    else if (saved && (await this.#onScreen(saved))) features.push(`left=${Math.round(saved.x)}`, `top=${Math.round(saved.y)}`);
    return features;
  }

  /** Whether the window's top-left area lies on a connected monitor (one may have been unplugged). */
  async #onScreen(bounds: WindowBounds): Promise<boolean> {
    try {
      const monitors = await availableMonitors();
      return monitors.some(({ position, size, scaleFactor }) => {
        const left = position.x / scaleFactor;
        const top = position.y / scaleFactor;
        const x = bounds.x + 40;
        const y = bounds.y + 20;
        return x >= left && y >= top && x < left + size.width / scaleFactor && y < top + size.height / scaleFactor;
      });
    } catch {
      return false;
    }
  }

  /** Notices a closed window and renders into the popup's document once it is ready or replaced. */
  #watch(popup: Popup) {
    if (popup.win.closed) {
      this.#release(popup);
      popup.spec.onClosed();
      return;
    }
    let current: Document;
    try {
      current = popup.win.document;
    } catch {
      return;
    }
    if (current !== popup.document && current.readyState === "complete" && current.body) this.#render(popup, current);
    if (!popup.unlisten) void this.#trackBounds(popup);
  }

  #render(popup: Popup, target: Document) {
    if (popup.component) this.#unmount(popup);
    popup.document = target;
    target.documentElement.lang = document.documentElement.lang;
    this.#copyStyles(target);
    this.#copyTheme(target);
    const root = target.createElement("div");
    root.className = "detached-root";
    target.body.replaceChildren(root);
    const view = target.defaultView;
    view?.addEventListener("keydown", handleShortcut);
    view?.addEventListener("dragover", refuseFiles);
    view?.addEventListener("drop", refuseFiles);
    view?.addEventListener("contextmenu", refuseContextMenu);
    if (view) refuseZoomIn(view);
    popup.component = popup.spec.render(root);
  }

  /** The page's stylesheets, copied into a popup and kept current (they change during development). */
  #copyStyles(target: Document) {
    for (const old of target.head.querySelectorAll("[data-copied-style]")) old.remove();
    for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
      const copy = target.importNode(node, true) as HTMLElement;
      copy.dataset.copiedStyle = "";
      target.head.append(copy);
    }
    this.#styleObserver ??= new MutationObserver(() => {
      for (const popup of this.#windows.values()) {
        if (popup.document && !popup.win.closed) this.#copyStyles(popup.document);
      }
    });
    this.#styleObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
  }

  /** Light or dark mode (`data-theme`, see theme.svelte.ts), as in this page, also when it changes. */
  #copyTheme(target: Document) {
    const theme = document.documentElement.dataset.theme;
    if (theme) target.documentElement.dataset.theme = theme;
    else delete target.documentElement.dataset.theme;
    this.#themeObserver ??= new MutationObserver(() => {
      for (const popup of this.#windows.values()) {
        if (popup.document && !popup.win.closed) this.#copyTheme(popup.document);
      }
    });
    this.#themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  /** Remembers where the user puts the window, through the native window's events. */
  async #trackBounds(popup: Popup) {
    popup.unlisten = [];
    const native = await TauriWindow.getByLabel(label(popup.spec.key)).catch(() => null);
    if (!native || this.#windows.get(popup.spec.key) !== popup) {
      // Not created yet: try again on the next check.
      popup.unlisten = null;
      return;
    }
    const save = () => {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = setTimeout(() => void this.#saveBounds(popup.spec.boundsKey, native), SAVE_BOUNDS_DELAY);
    };
    popup.unlisten = await Promise.all([native.onMoved(save), native.onResized(save)]);
    if (this.#windows.get(popup.spec.key) !== popup) for (const stop of popup.unlisten) stop();
  }

  async #saveBounds(boundsKey: string, native: TauriWindow) {
    try {
      if (await native.isMinimized()) return;
      const [position, size, scale] = await Promise.all([native.outerPosition(), native.innerSize(), native.scaleFactor()]);
      const bounds: WindowBounds = {
        x: position.x / scale,
        y: position.y / scale,
        width: size.width / scale,
        height: size.height / scale,
      };
      const panes = settings.data.panes;
      settings.update({ panes: { ...panes, bounds: { ...panes.bounds, [boundsKey]: bounds } } });
    } catch {
      // The window was closed in the meantime; its last saved place stays.
    }
  }

  #release(popup: Popup) {
    clearInterval(popup.timer);
    for (const stop of popup.unlisten ?? []) stop();
    this.#unmount(popup);
    if (this.#windows.get(popup.spec.key) === popup) this.#windows.delete(popup.spec.key);
  }

  #unmount(popup: Popup) {
    if (!popup.component) return;
    try {
      void unmount(popup.component);
    } catch {
      // The window's document is already gone.
    }
    popup.component = null;
  }
}

/** Label of a popup's native window: named after this main window (see `window/mod.rs`). */
function label(key: string) {
  return `${getCurrentWindow().label}-pane-${key}`;
}

export const popups = new Popups();

/** Where the editor and the PDF preview are shown: docked, in windows of their own, or not at all. */
class PaneStore {
  /**
   * Width (px) the docked PDF pane needs so that a whole page fits its height at
   * 100 %; reported by the pane. `0` until it is known.
   */
  pdfFitWidth = $state(0);
  /** Share of the editor when docked side by side; `null` follows `pdfFitWidth` on every screen. */
  manualSplit = $state<number | null>(null);
  /** While the divider glides back to the fitting width (see `fitPage`). */
  animatingSplit = $state(false);
  #animationTimer: ReturnType<typeof setTimeout> | undefined;

  /** Moves the divider back to where a whole page fits, gliding there. */
  fitPage() {
    if (this.manualSplit === null) return;
    clearTimeout(this.#animationTimer);
    this.animatingSplit = true;
    this.manualSplit = null;
    this.#animationTimer = setTimeout(() => (this.animatingSplit = false), SPLIT_ANIMATION_MS);
  }

  get mode(): Record<PaneId, PaneMode> {
    const { editor, pdf } = settings.data.panes;
    return { editor, pdf };
  }

  /** Shows the pane in the main window. */
  dock(id: PaneId) {
    popups.close(id);
    this.#setMode(id, "docked");
  }

  close(id: PaneId) {
    popups.close(id);
    this.#setMode(id, "closed");
  }

  /**
   * Moves the pane into a window of its own, or brings that window to the front.
   * `at` puts the new window's top-left corner there (screen point in logical
   * pixels), e.g. where a dragged tab was released.
   */
  async detach(id: PaneId, at?: { x: number; y: number }) {
    if (popups.has(id)) {
      await popups.focus(id);
      return;
    }
    if (await popups.open(this.#spec(id), at)) this.#setMode(id, "detached");
    else this.#setMode(id, "docked");
  }

  /** Brings back closed panes, e.g. when a file is opened; detached ones stay where they are. */
  show(...ids: PaneId[]) {
    for (const id of ids) if (this.mode[id] === "closed") this.#setMode(id, "docked");
  }

  /** Docks every pane and fits the preview to the page again, as after a fresh installation. */
  reset() {
    for (const id of PANES) this.dock(id);
    this.manualSplit = null;
  }

  /** Reopens the windows of panes that were detached when the app was last closed. */
  async restoreWindows() {
    for (const id of PANES) {
      if (this.mode[id] === "detached" && !popups.has(id) && !(await popups.open(this.#spec(id)))) {
        this.#setMode(id, "docked");
      }
    }
  }

  #spec(id: PaneId): PopupSpec {
    return {
      key: id,
      boundsKey: id,
      defaultSize: DEFAULT_SIZE[id],
      render: (target) => mount(PaneFrame, { target, props: { id, detached: true } }),
      // Closed with the window's own close button: like the tab's cross.
      onClosed: () => {
        if (this.mode[id] === "detached") this.#setMode(id, "closed");
      },
    };
  }

  #setMode(id: PaneId, mode: PaneMode) {
    if (this.mode[id] !== mode) settings.update({ panes: { ...settings.data.panes, [id]: mode } });
  }
}

export const panes = new PaneStore();
