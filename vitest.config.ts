// Unit tests of the page's code: `npm test` (see scripts/test.mjs).
//
// A configuration of its own instead of vite.config.js: Paraglide's plugin
// there rewrites src/lib/paraglide, which would reload a running `tauri dev`.
// The tests use the messages as compiled (see tests/paraglide.ts).
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Compiles the runes in *.svelte.ts.
  plugins: [svelte()],
  resolve: {
    alias: { $lib: fileURLToPath(new URL("./src/lib", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/paraglide.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
