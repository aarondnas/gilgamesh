// Runs Vitest (`npm test`; arguments go through, e.g. `npm test -- --watch`).
//
// From the project folder with the drive letter in upper case: a shell that
// reports it as `c:` makes Node load Vitest under that spelling while Vite
// resolves the tests' imports of it to `C:`, and the tests then find no runner.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/^[a-z]:/, (drive) => drive.toUpperCase());
const cli = join(root, "node_modules", "vitest", "vitest.mjs");
const { status } = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { cwd: root, stdio: "inherit" });
process.exit(status ?? 1);
