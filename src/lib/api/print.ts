// Printing the PDF (src-tauri/src/commands/print.rs).
import { invoke } from "@tauri-apps/api/core";

export interface Printer {
  name: string;
  isDefault: boolean;
}

export interface PrintOptions {
  /** `null` prints on the default printer. */
  printer: string | null;
  copies: number;
  collate: boolean;
  duplex: "oneSided" | "longEdge" | "shortEdge";
  grayscale: boolean;
  /** How the paper lies; the sheets come laid out already, pages per sheet included. */
  landscape: boolean;
}

export type PrintStatus = "succeeded" | "printerUnavailable" | "failed";

/** The paper's size in millimetres, upright. */
export interface Paper {
  width: number;
  height: number;
}

export const printApi = {
  printPrinters: () => invoke<Printer[]>("print_printers"),
  /** Opens the system's page for adding printers, which also searches the network. */
  printAddPrinter: () => invoke<void>("print_add_printer"),
  /**
   * The paper to lay the sheets out for; `null` where the printed page is the
   * viewport (WebView2), so the sheets simply fill it.
   */
  printPaper: () => invoke<Paper | null>("print_paper"),
  /** Prints this page as laid out under `@media print` (see `pdf/print.ts`). */
  printPage: (options: PrintOptions) => invoke<PrintStatus>("print_page", { options }),
};
