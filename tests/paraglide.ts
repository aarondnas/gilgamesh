// Compiles the messages for the tests where no dev server or build has done
// so yet (a fresh checkout). Left alone otherwise: rewriting them would
// reload a running `tauri dev`.
import { existsSync } from "node:fs";
import { compile } from "@inlang/paraglide-js";

export default async function setup() {
  if (existsSync("src/lib/paraglide/messages.js")) return;
  await compile({ project: "./project.inlang", outdir: "./src/lib/paraglide" });
}
