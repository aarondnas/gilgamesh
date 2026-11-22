// The lists the list dialogs offer (contents, figures, tables, …): the name
// of each, also the heading suggested for it, and its icon.

import BookA from "@lucide/svelte/icons/book-a";
import CaseUpper from "@lucide/svelte/icons/case-upper";
import Code from "@lucide/svelte/icons/code";
import Image from "@lucide/svelte/icons/image";
import Library from "@lucide/svelte/icons/library";
import ListTree from "@lucide/svelte/icons/list-tree";
import Omega from "@lucide/svelte/icons/omega";
import Sigma from "@lucide/svelte/icons/sigma";
import Table from "@lucide/svelte/icons/table";
import TextSearch from "@lucide/svelte/icons/text-search";
import type { Component } from "svelte";
import type { ListKind } from "$lib/latex/lists";
import { m } from "$lib/paraglide/messages";

/** Per list: its name (also the heading suggested) and icon. */
export const listNames: Record<ListKind, { name: () => string; icon: Component<{ size?: number; class?: string }> }> = {
  contents: { name: m.list_contents_name, icon: ListTree },
  figures: { name: m.list_figures_name, icon: Image },
  tables: { name: m.list_tables_name, icon: Table },
  listings: { name: m.list_listings_name, icon: Code },
  equations: { name: m.list_equations_name, icon: Sigma },
  abbreviations: { name: m.list_abbreviations_name, icon: CaseUpper },
  symbols: { name: m.list_symbols_name, icon: Omega },
  glossary: { name: m.list_glossary_name, icon: BookA },
  bibliography: { name: m.list_bibliography_name, icon: Library },
  index: { name: m.list_index_name, icon: TextSearch },
};
