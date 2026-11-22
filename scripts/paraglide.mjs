// Paraglide's options, shared by the app's build (vite.config.js), the tests
// (tests/paraglide.ts) and the type check (`npm run check`), so all of them
// compile the messages in messages/*.json the same way.
//
// Run directly (`node scripts/paraglide.mjs`), it compiles them where no dev
// server or build has done so yet (a fresh checkout, the CI) or they are older
// than the messages. Up-to-date output is left alone: rewriting it would reload
// a running `tauri dev`.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import("@inlang/paraglide-js").CompilerOptions} */
export const PARAGLIDE = {
  project: "./project.inlang",
  outdir: "./src/lib/paraglide",
  // The app replaces getLocale (see locale.svelte.ts) and keeps the choice in settings.json;
  // this only matters as a fallback.
  strategy: ["preferredLanguage", "baseLocale"],
  // Single-user webview, so no per-request isolation (which pulls in node:async_hooks) is needed.
  disableAsyncLocalStorage: true,
};

/** Files every compile writes; Paraglide's plugin may leave unchanged ones alone, so the newest counts. */
const OUTPUT = ["messages.js", "runtime.js", "messages/_index.js"];

/** Whether the compiled messages are missing or older than the messages or the project's settings. */
export function paraglideStale(root = ".") {
  const outputs = OUTPUT.map((file) => join(root, PARAGLIDE.outdir, file));
  if (!outputs.every((file) => existsSync(file))) return true;
  const compiled = Math.max(...outputs.map((file) => statSync(file).mtimeMs));
  const sources = [
    ...readdirSync(join(root, "messages")).map((name) => join(root, "messages", name)),
    join(root, PARAGLIDE.project, "settings.json"),
  ];
  return sources.some((file) => statSync(file).mtimeMs > compiled);
}

/** Compiles the messages if `paraglideStale`. */
export async function compileParaglide() {
  if (!paraglideStale()) return;
  const { compile } = await import("@inlang/paraglide-js");
  await compile(PARAGLIDE);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await compileParaglide();
}
