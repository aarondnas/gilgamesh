// The page layout of the document, in the main file: margins, paper and
// orientation, the header and footer with how the page numbers count, and
// the title page.

import { api } from "$lib/api";
import { ARTICLE, type Lang } from "$lib/config/template-texts";
import {
  marginsEdits,
  marginsSupported,
  orientationEdits,
  pageLayoutOf,
  paperEdits,
  type Margins,
  type Orientation,
  type PageLayout,
  type PaperName,
} from "$lib/latex/margins";
import {
  bodyLines,
  countingEdits,
  EMPTY_HEADER_FOOTER,
  headerFooterEdits,
  headerFooterOf,
  needsLastPage,
  regionsOf,
  type Counting,
  type HeaderFooter,
  type PageRegion,
} from "$lib/latex/page-numbers";
import { documentClassOf, hasChapters } from "$lib/latex/syntax";
import { hasSubtitle, plainText, setsTitle, titleDataOf, titleEdits, titlePageEdits, titlePageOf, type TitleData } from "$lib/latex/title";
import { m } from "$lib/paraglide/messages";
import { actions } from "./actions.svelte";
import { build } from "./build.svelte";
import { doc } from "./document.svelte";
import { formatting } from "./formatting.svelte";
import { locale } from "./locale.svelte";
import { project } from "./project.svelte";
import type { Unit } from "./units.svelte";

class PageLayoutStore {
  /** The margins and paper the main file sets, for the margins dialog; `null` where they cannot be set (beamer, no preamble). */
  async read(): Promise<PageLayout | null> {
    const source = await project.mainSource();
    return marginsSupported(source) ? pageLayoutOf(source) : null;
  }

  /** Sets the page margins, given in `unit`, in the main file's preamble (geometry). Errors propagate to the dialog. */
  async setMargins(margins: Margins, unit: Unit) {
    const main = project.config.main;
    if (!main) throw new Error(m.margins_no_document());
    const edits = marginsEdits(await project.mainSource(), margins, unit);
    if (!edits.length) throw new Error(m.margins_no_document());
    // Last first, so the offsets of the others stay right.
    for (const edit of edits) await actions.replaceText("user", main, edit.from, edit.to, edit.insert);
    void build.compile();
  }

  /** Sets the whole document in portrait or landscape, in the main file's preamble (geometry). */
  setOrientation(orientation: Orientation) {
    return this.#setPage((source) => orientationEdits(source, orientation));
  }

  /** Sets the whole document on paper `name` (A4, Letter, …), in the main file's preamble (geometry). */
  setPaper(name: PaperName) {
    return this.#setPage((source) => paperEdits(source, name));
  }

  async #setPage(edits: (source: string) => { from: number; to: number; insert: string }[]) {
    await doc.guard(async () => {
      const main = project.config.main;
      const source = main ? await project.mainSource() : "";
      if (!main || !marginsSupported(source)) throw new Error(m.page_setup_no_document());
      // Last first, so the offsets of the others stay right.
      for (const edit of edits(source)) await actions.replaceText("user", main, edit.from, edit.to, edit.insert);
      await formatting.refreshMainSource();
      void build.compile();
    });
  }

  /** The language the document's words are in ("Seite 3"): its own (babel/polyglossia), else the app's. */
  #documentLang(): Lang {
    const code = (project.scan?.language ?? locale.current).slice(0, 2);
    return (Object.hasOwn(ARTICLE, code) ? code : "en") as Lang;
  }

  /** The texts of the main file and the files it reads in, and the regions of its body (see latex/page-numbers.ts). */
  async pageRegions() {
    const main = project.config.main;
    const root = project.root;
    if (!main || !root) throw new Error(m.page_setup_no_document());
    const scan = await doc.rescan();
    const texts = new Map<string, string>();
    for (const file of [main, ...scan.inclusions.map((i) => i.file)]) {
      if (texts.has(file)) continue;
      const text = project.textOf(file) ?? (await api.projectRead(root, file).catch(() => null));
      if (text !== null) texts.set(file, text);
    }
    const lines = bodyLines(main, (file) => texts.get(file) ?? null, scan.inclusions);
    return { main, texts, regions: regionsOf(lines, scan.outline) };
  }

  /**
   * What the page number options of the header and footer dialog show: the
   * regions of the body with the PDF page each begins on in the last build
   * (`null` without one, or where SyncTeX has no answer). `null` where page
   * numbers cannot be set (beamer, no preamble).
   */
  async pageNumberState(): Promise<(PageRegion & { page: number | null })[] | null> {
    const source = await project.mainSource();
    if (!marginsSupported(source)) return null;
    const { main, regions } = await this.pageRegions();
    const pdfPath = build.lastResult?.pdfPath;
    const pages = await Promise.all(
      regions.map(async (region) => {
        if (!pdfPath) return null;
        const file = region.file === main ? null : project.absolute(region.file);
        // The start of the body sets nothing itself: the line after it does.
        const line = region.kind === "start" ? region.line + 1 : region.line;
        return (await api.synctexView(pdfPath, file, line).catch(() => null))?.page ?? null;
      }),
    );
    return regions.map((region, i) => ({ ...region, page: pages[i] }));
  }

  /**
   * What the header and footer dialog shows: what the preamble sets (the
   * document's own fancyhdr lines where Gilgamesh set none yet), and the
   * document's title and first author for the fields. `null` where they
   * cannot be set (beamer, no preamble).
   */
  async headerFooterState(): Promise<{
    setup: HeaderFooter;
    twoSided: boolean;
    lang: Lang;
    chapters: boolean;
    title: string;
    author: string;
  } | null> {
    const source = await project.mainSource();
    if (!marginsSupported(source)) return null;
    const own = headerFooterOf(source);
    const setup: HeaderFooter = own
      ? { fields: own.fields, style: own.style, small: own.small, rule: own.rule }
      : // As LaTeX's classes have it: the number at the foot, in the middle.
        { ...EMPTY_HEADER_FOOTER, fields: { "bottom-center": { kind: "page" } } };
    const data = titleDataOf(source);
    return {
      setup,
      twoSided: pageLayoutOf(source).twoSided,
      lang: this.#documentLang(),
      chapters: hasChapters(documentClassOf(source)?.name ?? ""),
      title: plainText(data.title),
      author: plainText(data.authors[0] ?? ""),
    };
  }

  /** The edits that make the regions `counting` names (by their place in `pageNumberState`'s list) count as it says, by file. */
  async #countingEdits(source: string, counting: Map<number, Counting>) {
    const { regions } = await this.pageRegions();
    if ([...counting.keys()].some((i) => i >= regions.length)) throw new Error(m.page_numbers_changed());
    const twoSided = pageLayoutOf(source).twoSided;
    const edits = new Map<string, { from: number; to: number; insert: string }[]>();
    for (const [i, wanted] of counting) {
      for (const [file, list] of countingEdits(regions[i], wanted, twoSided)) edits.set(file, [...(edits.get(file) ?? []), ...list]);
    }
    return edits;
  }

  async #applyEdits(edits: Map<string, { from: number; to: number; insert: string }[]>) {
    for (const [file, list] of edits) {
      // Last first, so the offsets of the others stay right.
      for (const edit of list.sort((a, b) => b.from - a.from)) await actions.replaceText("user", file, edit.from, edit.to, edit.insert);
    }
  }

  /**
   * Sets the header and footer in the main file's preamble (see
   * `headerFooterEdits`), and how the page numbers count from the regions
   * `counting` names by their place in `pageNumberState`'s list. Errors
   * propagate to the dialog.
   */
  async setHeaderFooter(setup: HeaderFooter, counting = new Map<number, Counting>()) {
    const main = project.config.main;
    const source = main ? await project.mainSource() : "";
    if (!main || !marginsSupported(source)) throw new Error(m.page_setup_no_document());
    const fields = headerFooterEdits(source, setup, this.#documentLang());
    if (!fields.length) throw new Error(m.page_setup_no_document());
    const edits = counting.size
      ? await this.#countingEdits(source, counting)
      : new Map<string, { from: number; to: number; insert: string }[]>();
    edits.set(main, [...(edits.get(main) ?? []), ...fields]);
    await this.#applyEdits(edits);
    await doc.loadPackages([
      "fancyhdr",
      ...(needsLastPage(setup.style) && Object.values(setup.fields).some((f) => f?.kind === "page") ? ["lastpage"] : []),
    ]);
    await formatting.refreshMainSource();
    void build.compile();
  }

  /** What the title dialog shows; `null` without a preamble. */
  async titleState(): Promise<{ data: TitleData; subtitle: boolean; sets: boolean; ownPage: boolean } | null> {
    const source = await project.mainSource();
    if (!marginsSupported(source)) return null;
    return { data: titleDataOf(source), subtitle: hasSubtitle(source), sets: setsTitle(source), ownPage: titlePageOf(source) };
  }

  /**
   * Writes the title, authors and date into the main file's preamble; with
   * `make` the body sets them (`\maketitle`), on a page of their own with
   * `ownPage`. Errors propagate to the dialog.
   */
  async setTitle(data: TitleData, make: boolean, ownPage: boolean) {
    const main = project.config.main;
    const source = main ? await project.mainSource() : "";
    if (!main || !marginsSupported(source)) throw new Error(m.page_setup_no_document());
    const edits = [...titleEdits(source, data, make), ...titlePageEdits(source, ownPage)].sort((a, b) => b.from - a.from);
    for (const edit of edits) await actions.replaceText("user", main, edit.from, edit.to, edit.insert);
    await formatting.refreshMainSource();
    void build.compile();
  }
}

export const pageLayout = new PageLayoutStore();
