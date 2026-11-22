<script lang="ts" module>
  import type { PDFDocumentProxy as LoadedPdf } from "pdfjs-dist";
  import type { Printer as KnownPrinter } from "$lib/api";

  /**
   * Kept while the page is closed, so opening it again shows at once: the
   * printers (asked for again in the background) and the PDF as pdf.js read
   * it, until a build brings another one.
   */
  let knownPrinters: KnownPrinter[] | null = null;
  let loaded: { data: ArrayBuffer; pdf: LoadedPdf; aspect: number } | null = null;
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import type { PDFDocumentProxy } from "pdfjs-dist";
  import FileText from "@lucide/svelte/icons/file-text";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Printer from "@lucide/svelte/icons/printer";
  import { api, errorMessage, type Printer as PrinterInfo } from "$lib/api";
  import { m } from "$lib/paraglide/messages";
  import { loadPdf, pageAspectOf, preparePrint } from "$lib/pdf/print";
  import { MAX_PAGES_PER_SIDE, parsePageRange, sheetLayout } from "$lib/pdf/sheets";
  import { doc } from "$lib/state/document.svelte";
  import { build } from "$lib/state/build.svelte";
  import PrintPreview from "./PrintPreview.svelte";
  import Button from "../ui/Button.svelte";

  let printers = $state<PrinterInfo[]>([]);
  let printer = $state<string | null>(null);
  let copies = $state(1);
  let collate = $state(true);
  let pagesMode = $state<"all" | "range">("all");
  let rangeText = $state("");
  let twoSided = $state(true);
  /** Chosen by the user; `null` turns the sheets like a book. */
  let flipChoice = $state<"long" | "short" | null>(null);
  let grayscale = $state(false);
  let pagesPerSide = $state(1);

  let pdf = $state.raw<PDFDocumentProxy | null>(null);
  /** Width / height of the PDF's first page. */
  let pdfAspect = $state(210 / 297);

  /** How the paper lies: as the PDF's pages, unless several pages per sheet turn it. */
  const layout = $derived(sheetLayout(pagesPerSide, pdfAspect));
  const sheetLandscape = $derived(layout.landscape);
  // Like a book by default: portrait sheets flip on the long edge, landscape ones on the short.
  const flipEdge = $derived(flipChoice ?? (sheetLandscape ? "short" : "long"));
  // The edge stands upright (sheets turn sideways) or lies (they turn upwards, like a calendar).
  const flipAxis = $derived((flipEdge === "long") !== sheetLandscape ? "vertical" : "horizontal");

  /** What the button is doing: rendering sheets (with progress) or waiting for the spooler. */
  let phase = $state<{ kind: "idle" } | { kind: "preparing"; done: number; total: number } | { kind: "printing" }>({
    kind: "idle",
  });
  let result = $state<{ ok: boolean; text: string } | null>(null);

  const pageCount = $derived(pdf?.numPages ?? 0);
  const pages = $derived.by(() => {
    if (!pdf) return null;
    if (pagesMode === "all") return Array.from({ length: pdf.numPages }, (_, i) => i + 1);
    return parsePageRange(rangeText, pdf.numPages);
  });
  const busy = $derived(phase.kind !== "idle");

  onMount(async () => {
    const choose = (list: PrinterInfo[]) => {
      printers = list;
      if (!printer || !list.some((p) => p.name === printer)) {
        printer = list.find((p) => p.isDefault)?.name ?? list[0]?.name ?? null;
      }
    };
    if (knownPrinters) choose(knownPrinters);
    // Asked anew in the background: printers come and go.
    knownPrinters = await api.printPrinters().catch(() => knownPrinters ?? []);
    choose(knownPrinters);
  });

  // The latest build: a new PDF replaces the preview, from the first page.
  $effect(() => {
    const data = build.pdf;
    if (!data) {
      pdf = null;
      return;
    }
    if (loaded?.data === data) {
      pdfAspect = loaded.aspect;
      pdf = loaded.pdf;
      return;
    }
    let cancelled = false;
    void loadPdf(data).then(async (next) => {
      if (cancelled) return void next.loadingTask.destroy();
      const aspect = await pageAspectOf(next);
      if (cancelled) return void next.loadingTask.destroy();
      // The one read before is not shown any more.
      void loaded?.pdf.loadingTask.destroy();
      loaded = { data, pdf: next, aspect };
      pdfAspect = aspect;
      pdf = next;
    });
    return () => {
      cancelled = true;
    };
  });

  async function print() {
    if (!pdf || !pages || busy) return;
    result = null;
    const printerName = printer;
    let cleanup: (() => void) | null = null;
    try {
      phase = { kind: "preparing", done: 0, total: pages.length };
      const total = pages.length;
      cleanup = await preparePrint(pdf, pages, pagesPerSide, layout, (done) => (phase = { kind: "preparing", done, total }));
      phase = { kind: "printing" };
      const status = await api.printPage({
        printer: printerName,
        copies: Math.max(1, Math.floor(copies) || 1),
        collate,
        duplex: twoSided ? (flipEdge === "short" ? "shortEdge" : "longEdge") : "oneSided",
        grayscale,
        // Paper lies as the sheets need it, e.g. across for a Beamer presentation.
        landscape: sheetLandscape,
      });
      result =
        status === "succeeded"
          ? { ok: true, text: m.print_done({ printer: printerName ?? "" }) }
          : { ok: false, text: status === "printerUnavailable" ? m.print_unavailable() : m.print_failed() };
    } catch (err) {
      result = { ok: false, text: `${m.print_failed()} ${errorMessage(err)}` };
    } finally {
      cleanup?.();
      phase = { kind: "idle" };
    }
  }
</script>

<div class="print">
  <!-- A choice made lets go of the field, so the arrow keys turn the preview's pages again. -->
  <aside
    class="settings"
    onchange={(e) => {
      const field = e.target as HTMLElement;
      if (field instanceof HTMLSelectElement || (field instanceof HTMLInputElement && field.type === "checkbox")) {
        field.blur();
      }
    }}
  >
    <h1>{m.file_print()}</h1>

    <div class="action">
      <button class="print-button" onclick={print} disabled={!pdf || !pages || !printer || busy}>
        {#if busy}
          <LoaderCircle size={30} strokeWidth={1.5} class="spin" />
        {:else}
          <Printer size={30} strokeWidth={1.5} />
        {/if}
        {m.print_button()}
      </button>
      <label class="copies">
        <span>{m.print_copies()}</span>
        <input type="number" min="1" max="999" bind:value={copies} disabled={busy} />
      </label>
    </div>

    {#if phase.kind === "preparing"}
      <p class="status">{m.print_preparing({ done: phase.done, total: phase.total })}</p>
    {:else if phase.kind === "printing"}
      <p class="status">{m.print_printing()}</p>
    {:else if result}
      <p class="status" class:error={!result.ok}>{result.text}</p>
    {/if}

    <h2>{m.print_printer()}</h2>
    {#if printers.length > 0}
      <select bind:value={printer} disabled={busy}>
        {#each printers as p (p.name)}
          <option value={p.name}>{p.isDefault ? m.print_printer_default({ name: p.name }) : p.name}</option>
        {/each}
      </select>
    {:else}
      <p class="hint">{m.print_no_printers()}</p>
    {/if}

    <h2>{m.print_settings()}</h2>
    <select bind:value={pagesMode} disabled={busy}>
      <option value="all">{m.print_pages_all()}</option>
      <option value="range">{m.print_pages_range()}</option>
    </select>
    {#if pagesMode === "range"}
      <input
        class="range"
        class:invalid={rangeText.trim() !== "" && !pages}
        bind:value={rangeText}
        placeholder={m.print_pages_placeholder()}
        disabled={busy}
      />
      {#if rangeText.trim() !== "" && !pages}<p class="hint error">{m.print_pages_invalid({ count: pageCount })}</p>{/if}
    {/if}

    <label class="check">
      <input type="checkbox" bind:checked={twoSided} disabled={busy} />
      {m.print_two_sided()}
    </label>
    {#if twoSided}
      <select value={flipEdge} onchange={(e) => (flipChoice = e.currentTarget.value as "long" | "short")} disabled={busy}>
        <option value="long">{m.print_flip_long()}</option>
        <option value="short">{m.print_flip_short()}</option>
      </select>
    {/if}

    {#if copies > 1}
      <select bind:value={collate} disabled={busy}>
        <option value={true}>{m.print_collated()}</option>
        <option value={false}>{m.print_uncollated()}</option>
      </select>
    {/if}

    <select bind:value={pagesPerSide} disabled={busy}>
      {#each Array.from({ length: MAX_PAGES_PER_SIDE }, (_, i) => i + 1) as n (n)}
        <option value={n}>{n === 1 ? m.print_one_per_sheet() : m.print_per_sheet({ count: n })}</option>
      {/each}
    </select>

    <select bind:value={grayscale} disabled={busy}>
      <option value={false}>{m.print_color()}</option>
      <option value={true}>{m.print_grayscale()}</option>
    </select>

    {#if build.compileCurrentOnly}<p class="hint">{m.print_partial()}</p>{/if}
  </aside>

  <section class="preview">
    {#if pdf && pages}
      <PrintPreview {pdf} {pages} {pagesPerSide} {twoSided} axis={flipAxis} {grayscale} />
    {:else if !build.pdf}
      <div class="empty">
        <FileText size={40} strokeWidth={1.2} />
        <p>{m.print_no_pdf()}</p>
        <Button variant="primary" size="md" disabled={build.building} onclick={() => build.compile()}>{m.ribbon_compile()}</Button>
      </div>
    {/if}
  </section>
</div>

<style>
  .print {
    display: flex;
    height: 100%;
    background: var(--surface);
  }

  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    flex-shrink: 0;
    width: 300px;
    padding: var(--space-8) var(--space-7) var(--space-7) var(--space-8);
    overflow-y: auto;
    box-sizing: border-box;
  }

  h1 {
    margin: 0 0 var(--space-4);
    font-size: 28px;
    font-weight: 400;
  }

  h2 {
    margin: var(--space-6) 0 0;
    font-size: var(--font-sm);
    font-weight: 600;
    color: var(--text-muted);
  }

  .action {
    display: flex;
    align-items: stretch;
    gap: var(--space-5);
  }

  .print-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    width: 96px;
    height: 96px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--font-base);
    transition:
      border-color 150ms ease,
      background-color 150ms ease;
  }

  .print-button :global(svg) {
    color: var(--accent-strong);
  }

  .print-button:hover:not(:disabled) {
    border-color: var(--accent-strong);
    background: var(--hover);
  }

  .print-button:active:not(:disabled) {
    background: var(--pressed);
  }

  .print-button:disabled {
    opacity: 0.5;
  }

  .print-button :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    font-size: var(--font-base);
  }

  .check input {
    width: auto;
    margin: 0;
    padding: 0;
    accent-color: var(--accent-strong);
  }

  .copies {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2);
    font-size: var(--font-sm);
    font-weight: 600;
  }

  .copies input {
    width: 72px;
  }

  select,
  input {
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--font-base);
    font-weight: normal;
    box-sizing: border-box;
  }

  select:focus,
  input:focus {
    outline: none;
    border-color: var(--accent-strong);
  }

  input.invalid {
    border-color: var(--error);
  }

  .status {
    margin: 0;
    font-size: var(--font-sm);
    color: var(--text-muted);
  }

  .hint {
    margin: 0;
    font-size: var(--font-sm);
    line-height: 1.4;
    color: var(--text-muted);
  }

  .error {
    color: var(--error);
  }

  .preview {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    /* The book's empty half, scaled up beside a single page, must not reach over the settings. */
    overflow: hidden;
    background: var(--canvas);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-5);
    flex: 1;
    color: var(--text-muted);
    text-align: center;
  }

  .empty p {
    max-width: 320px;
    margin: 0;
    line-height: 1.5;
  }
</style>
