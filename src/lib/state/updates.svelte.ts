// New versions of Gilgamesh (src-tauri/src/updates.rs): what the backend knows, checking now and
// installing after asking. The backend checks by itself once a day; this reads its status now and
// then, quickly while it checks or downloads. Before the install the backend asks every main
// window to save (`onUpdateSave`), as closing it would; from then on the window takes no input.
import { openUrl } from "@tauri-apps/plugin-opener";
import { ask } from "@tauri-apps/plugin-dialog";
import { api, errorMessage, events, type UpdateStatus } from "$lib/api";
import { freezeEditors } from "$lib/editor/latex-editor";
import { m } from "$lib/paraglide/messages";
import { project } from "./project.svelte";
import { review } from "./review.svelte";

/** Where new versions are downloaded by hand: for copies that cannot update themselves, and when updates no longer come this way. */
export const WEBSITE_URL = "https://pigeonbits.com/products/gilgamesh#download";

/** How often the status is read: quickly while checking or downloading, otherwise now and then. */
const FAST_MS = 500;
const SLOW_MS = 60_000;

class UpdateStore {
  status = $state<UpdateStatus | null>(null);
  #closing = $state(false);

  /** The files are saved for the install: the window waits for Gilgamesh to end and its editors take no input. */
  get closing(): boolean {
    return this.#closing;
  }

  set closing(closing: boolean) {
    this.#closing = closing;
    freezeEditors(closing);
  }

  /** Why "Check now" or the install failed, in the user's language. */
  error = $derived(this.status?.error ? errorMessage(this.status.error) : null);
  #timer: ReturnType<typeof setTimeout> | undefined;

  /** A new version that can be installed with the known key. */
  get available(): string | null {
    const s = this.status;
    return s?.available && s.lost !== "untrusted" ? s.available.version : null;
  }

  /** Share downloaded, 0–100; `null` while the size is unknown. */
  get percent(): number | null {
    const s = this.status;
    return s?.total ? Math.min(100, Math.floor((s.downloaded / s.total) * 100)) : null;
  }

  /** Reads the status now and then and saves when an install asks for it; returns the function that stops both. */
  start(): () => void {
    void this.#refresh();
    const unlisten = events.onUpdateSave(() => void this.#saveForInstall());
    return () => {
      clearTimeout(this.#timer);
      void unlisten.then((stop) => stop());
    };
  }

  async #refresh() {
    clearTimeout(this.#timer);
    try {
      this.status = await api.updateStatus();
    } catch {
      // Backend briefly unreachable: the next round tries again.
    }
    // The install failed after this window saved (or another one could not): it works as before.
    if (this.status && !this.status.installing) this.closing = false;
    const busy = this.status?.checking || this.status?.installing;
    this.#timer = setTimeout(() => void this.#refresh(), busy ? FAST_MS : SLOW_MS);
  }

  /** "Check now" in the settings. */
  async check() {
    if (this.status) this.status = { ...this.status, checking: true, error: null };
    try {
      this.status = await api.updateCheck();
    } catch (err) {
      if (this.status) this.status = { ...this.status, checking: false, error: String(err) };
    }
  }

  /** Installs the version found, after asking; Gilgamesh saves, ends and starts again with it. */
  async install() {
    const version = this.available;
    if (!version || this.status?.installing) return;
    const confirmed = await ask(m.update_confirm({ version }), {
      title: m.update_confirm_title(),
      kind: "info",
      okLabel: m.update_install(),
      cancelLabel: m.update_cancel(),
    });
    if (!confirmed) return;
    // Fast reads show the download.
    setTimeout(() => void this.#refresh(), FAST_MS);
    try {
      await api.updateInstall();
    } catch {
      // The status says why; the window works as before.
      this.closing = false;
    } finally {
      void this.#refresh();
    }
  }

  /** Writes what is not saved yet, as closing the window does, and tells the backend. */
  async #saveForInstall() {
    this.closing = true;
    // Focus would stay in the editor beneath the notice.
    (document.activeElement as HTMLElement | null)?.blur();
    try {
      await Promise.all([project.flush(), review.flush()]);
      await api.updateSaved(null);
    } catch (err) {
      this.closing = false;
      await api.updateSaved(errorMessage(err)).catch(() => {});
    }
  }

  /** The website, to download the new version and install it over this one. */
  openWebsite() {
    void openUrl(WEBSITE_URL);
  }
}

export const updates = new UpdateStore();
