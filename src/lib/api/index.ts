// Typed bridge to the Rust backend: one file per domain, as the commands in
// src-tauri/src/commands/.
import { gitApi } from "./git";
import { localize } from "./localize";
import { mcpApi } from "./mcp";
import { printApi } from "./print";
import { projectApi } from "./project";
import { settingsApi } from "./settings";
import { spellApi } from "./spell";
import { texApi } from "./tex";
import { updateApi } from "./update";
import { windowApi } from "./window";

export * from "./git";
export * from "./mcp";
export * from "./print";
export * from "./project";
export * from "./tex";
export * from "./update";
export * from "./window";
export { events } from "./events";
export { localize, translate } from "./localize";

export const api = {
  ...texApi,
  ...spellApi,
  ...settingsApi,
  ...projectApi,
  ...gitApi,
  ...mcpApi,
  ...printApi,
  ...windowApi,
  ...updateApi,
};

/** What went wrong, in the user's language: a backend error (see `localize`) or a thrown `Error`. */
export function errorMessage(err: unknown): string {
  return localize(err instanceof Error ? err.message : String(err));
}
