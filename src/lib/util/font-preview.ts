// Each font of the font list shown in itself. System fonts the WebView knows
// by name; the catalog's are not installed on the system but lie in the TeX
// distribution, so their upright faces are loaded from there once (FontFace).
// A face that cannot be loaded (its package not installed) leaves the font in
// the interface's font. The font manager's fonts (fonts.svelte.ts) show in
// themselves once their faces are loaded.

import { api } from "$lib/api";
import { fonts } from "$lib/state/fonts.svelte";
import { CATALOG, managedFamily } from "../latex/fonts";

let loaded = false;

/** Loads the catalog's faces from the distribution, once. */
export function loadCatalogFonts() {
  if (loaded || typeof FontFace === "undefined") return;
  loaded = true;
  for (const font of CATALOG) {
    api
      .texFont(font.file)
      .then((bytes) => new FontFace(font.otf, bytes).load())
      .then((face) => document.fonts.add(face))
      .catch(() => {});
  }
}

const quoted = (family: string) => `"${family.replace(/["\\]/g, "")}"`;

/** The CSS font family that shows the font `key` (see latex/fonts.ts); none for a setup Gilgamesh does not know. */
export function previewFamily(key: string): string | undefined {
  if (key.startsWith("tex:")) {
    const font = CATALOG.find((one) => `tex:${one.id}` === key);
    return font && `${quoted(font.otf)}, var(--font-ui)`;
  }
  if (key.startsWith("system:")) return `${quoted(key.slice("system:".length))}, var(--font-ui)`;
  const family = managedFamily(key);
  if (family && fonts.previews[family.id] === "ready") return `${quoted(fonts.cssFamily(family))}, var(--font-ui)`;
  return undefined;
}

/** Loads the faces of the font manager's font `key` where it is installed, so the font list shows it in itself. */
export function loadManagedFont(key: string) {
  const family = managedFamily(key);
  if (family?.installed) void fonts.preview(family, false);
}
