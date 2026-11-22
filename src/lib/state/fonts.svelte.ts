// The font manager's catalog: every font family of the TeX repository
// (src-tauri/src/tex/fonts.rs), and their faces for showing each in itself.
// A face is loaded once, under a family name of its own, from the
// distribution or, for a package not installed, from its archive.
//
// Fetching archives sends the user's address to the TeX Live server, so it
// happens only once the user agreed (`downloadsAllowed`), or for one family
// the user clicked on. Then they are fetched one at a time, and only for the
// families the catalog wants (`want`): its page and the next; a page turned
// past drops what it wanted. Without consent, only what is installed or was
// fetched before shows in itself.

import { api, errorMessage, type FontFamily } from "$lib/api";
import { fileName } from "$lib/util/paths";
import { packages } from "./packages.svelte";
import { settings } from "./settings.svelte";

export type PreviewState = "loading" | "ready" | "failed";

/** Larger packages are only fetched for a preview when asked for (`preview`), not for being on screen. */
const AUTO_PREVIEW_LIMIT = 10_000_000;

class FontStore {
  families = $state.raw<FontFamily[]>([]);
  loaded = $state(false);
  loading = $state(false);
  error = $state<string | null>(null);
  /** The server previews come from (`tlnet.yihui.org`), for asking the user; `null` until read. */
  host = $state<string | null>(null);
  /** Whether the font manager is open. */
  dialog = $state(false);
  /** How far each family's regular face is, by id. */
  previews = $state<Record<string, PreviewState>>({});
  /** Families the catalog shows or is about to, whose face is still to fetch, in that order, by id. */
  #wanted = new Map<string, FontFamily>();
  /** Families the catalog shows or is about to, by id. */
  #visible = new Set<string>();
  #pumping = false;
  /** Families whose italic and bold faces are loaded too. */
  #styled = new Set<string>();
  /** Families neither installed nor fetched before, which only a download can show. */
  #notLocal = new Set<string>();

  /** Whether the user agreed that the catalog fetches previews of fonts not installed. */
  get downloadsAllowed() {
    return settings.data.fontPreviewsAsked && settings.data.fontPreviewDownloads;
  }

  /** Records the user's decision on fetching previews. */
  allowDownloads(allowed: boolean) {
    settings.update({ fontPreviewDownloads: allowed, fontPreviewsAsked: true });
  }

  /** Reads the catalog; again after packages were installed, for what is installed now. */
  async load(again = false) {
    if ((this.loaded && !again) || this.loading || !packages.installed) return;
    this.loading = true;
    this.error = null;
    try {
      this.families = await api.fontFamilies();
      this.host ??= await api.fontPreviewHost().catch(() => null);
      this.loaded = true;
    } catch (err) {
      this.error = errorMessage(err);
    } finally {
      this.loading = false;
    }
  }

  /** The family whose regular face is the file `name` (`EBGaramond-Regular.otf`). */
  byFile(name: string): FontFamily | undefined {
    return this.families.find((family) => fileName(family.regular) === name);
  }

  /** The family pdfLaTeX sets with the package `sty`. */
  bySty(sty: string): FontFamily | undefined {
    return this.families.find((family) => family.sty === sty);
  }

  /** The CSS family its preview faces are loaded under. */
  cssFamily(family: FontFamily) {
    return `Gilgamesh ${family.id.replace(/[^A-Za-z0-9 ]/g, " ")}`;
  }

  /**
   * Whether `family` shows in itself only when clicked on: its package is not installed
   * or fetched before, and fetching is not allowed or the package is large.
   */
  onRequest(family: FontFamily) {
    if (family.installed || this.previews[family.id] === "ready") return false;
    return !this.downloadsAllowed || family.size > AUTO_PREVIEW_LIMIT;
  }

  /**
   * The catalog shows `family` or is about to (`visible`), or no longer. What is
   * on disk (installed, or fetched before) loads at once; the others queue for
   * their archive while they are wanted, if the user agreed to that.
   */
  want(family: FontFamily, visible: boolean) {
    if (!visible || this.previews[family.id]) {
      this.#visible.delete(family.id);
      this.#wanted.delete(family.id);
      return;
    }
    this.#visible.add(family.id);
    if (family.installed || !this.#notLocal.has(family.id)) {
      void this.preview(family, false).then((shown) => {
        if (!shown) this.#queue(family);
      });
      return;
    }
    this.#queue(family);
  }

  /** Queues `family` for its archive, if it is still wanted and the user agreed. */
  #queue(family: FontFamily) {
    if (family.installed || !this.#visible.has(family.id) || !this.downloadsAllowed || family.size > AUTO_PREVIEW_LIMIT) return;
    this.#wanted.set(family.id, family);
    void this.#pump();
  }

  /** Nothing is wanted any more (another page, or the catalog closed). */
  forgetWanted() {
    this.#visible.clear();
    this.#wanted.clear();
  }

  async #pump() {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      for (let next = this.#first(); next; next = this.#first()) {
        this.#wanted.delete(next.id);
        // The user may have withdrawn consent meanwhile.
        if (this.downloadsAllowed) await this.preview(next, true);
      }
    } finally {
      this.#pumping = false;
    }
  }

  #first(): FontFamily | undefined {
    return this.#wanted.values().next().value;
  }

  /**
   * Loads the regular face of `family`: from disk, or with `fetch` from its archive
   * (what the user agreed to, or asked for by a click). `true` once it shows.
   */
  async preview(family: FontFamily, fetch: boolean): Promise<boolean> {
    const state = this.previews[family.id];
    if (state === "ready") return true;
    if (state === "loading" || typeof FontFace === "undefined") return false;
    if (!fetch && !family.installed && this.#notLocal.has(family.id)) return false;
    this.previews[family.id] = "loading";
    try {
      if (await this.#loadFace(family, family.regular, {}, fetch)) {
        this.previews[family.id] = "ready";
        return true;
      }
      this.#notLocal.add(family.id);
      delete this.previews[family.id];
      return false;
    } catch {
      this.previews[family.id] = "failed";
      return false;
    }
  }

  /** Loads its italic and bold faces too, for the chosen family, where its regular one shows: from the same place, never fetched anew. */
  async previewStyles(family: FontFamily) {
    if (this.#styled.has(family.id) || this.previews[family.id] !== "ready") return;
    this.#styled.add(family.id);
    const faces: [string | null, FontFaceDescriptors][] = [
      [family.italic, { style: "italic" }],
      [family.bold, { weight: "700" }],
      [family.boldItalic, { style: "italic", weight: "700" }],
    ];
    for (const [face, descriptors] of faces) {
      if (face) await this.#loadFace(family, face, descriptors, false).catch(() => {});
    }
  }

  /** `false` where the face is not on disk and was not to be fetched. */
  async #loadFace(family: FontFamily, face: string, descriptors: FontFaceDescriptors, fetch: boolean) {
    const bytes = await api.fontFace(family.package, face, fetch);
    if (!bytes.byteLength) return false;
    document.fonts.add(await new FontFace(this.cssFamily(family), bytes, descriptors).load());
    return true;
  }

  /** Installs the package of `family`; `true` once it is. */
  async install(family: FontFamily): Promise<boolean> {
    await packages.install([family.package]);
    // Read again rather than assumed: another tlmgr task may have kept it from running.
    await this.load(true);
    return this.families.some((f) => f.id === family.id && f.installed);
  }
}

export const fonts = new FontStore();
