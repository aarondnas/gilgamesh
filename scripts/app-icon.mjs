// Builds the app's icons in src-tauri/icons/ from src-tauri/app-icon.svg: `npm run icon`.
// `tauri icon` renders the PNGs. icon.ico is packed here instead:
// Explorer and the taskbar draw 16 px up to 72 px at 300 % and more, and the
// file holds each of those sizes, so Windows never scales one (see taskbar_icon.rs).
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 96, 128, 256];
const here = dirname(fileURLToPath(import.meta.url));
const tauri = join(here, "..", "src-tauri");
const source = join(tauri, "app-icon.svg");
const icons = join(tauri, "icons");
const scratch = mkdtempSync(join(tmpdir(), "gilgamesh-icon-"));

try {
  // The CLI's own script run by this Node: no shell, so paths with spaces stay whole.
  const cli = createRequire(import.meta.url).resolve("@tauri-apps/cli/tauri.js");
  const tauriIcon = (output, ...args) => execFileSync(process.execPath, [cli, "icon", source, "-o", output, ...args], { stdio: "inherit" });

  // The full set, of which only the PNGs icons/ holds are taken (not Android's, iOS's or macOS's).
  const full = join(scratch, "full");
  tauriIcon(full);
  for (const name of readdirSync(icons)) {
    if (name.endsWith(".png")) copyFileSync(join(full, name), join(icons, name));
  }

  const sized = join(scratch, "sized");
  tauriIcon(sized, "-p", SIZES.join(","));
  const images = SIZES.map((size) => ({ size, data: readFileSync(join(sized, `${size}x${size}.png`)) }));

  // ICONDIR, one ICONDIRENTRY per image, then the PNGs themselves.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 stands for 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  const target = join(icons, "icon.ico");
  writeFileSync(target, Buffer.concat([header, ...entries, ...images.map((image) => image.data)]));
  console.log(`${target}: ${SIZES.join(", ")} px`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
