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

export const printApi = {
  printPrinters: () => invoke<Printer[]>("print_printers"),
  /** Prints this page as laid out under `@media print` (see `pdf/print.ts`). */
  printPage: (options: PrintOptions) => invoke<PrintStatus>("print_page", { options }),
};
