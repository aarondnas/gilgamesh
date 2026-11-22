// Builds static/third-party-notices.txt, the licenses of everything the app
// ships that others made: `npm run notices`, also before every `tauri build`.
// It lists the npm packages the frontend bundles (the runtime dependencies,
// Svelte, SvelteKit and Paraglide's runtime, with all they depend on), the
// crates compiled into the program for this machine's target (normal
// dependencies only), Microsoft's WebView2 loader that webview2-com-sys links
// in, and the Unicode character names of the symbol table. Each license text
// comes from the package itself; packages that ship none get their license's
// standard text, with their authors. Packages under the same text share it.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(repo, "static", "third-party-notices.txt");
const notices = join(repo, "scripts", "notices");

/** Packages that run in the app although package.json lists them for building. */
const BUNDLED_TOOLS = ["svelte", "@sveltejs/kit"];
/** Only their runtime goes into the bundle, not what they build it with. */
const RUNTIME_ONLY = ["@inlang/paraglide-js"];

const LICENSE_FILE = /^(licen[cs]e|copying|notice|copyright)([-._].*)?$/i;

const MIT = (holders) => `MIT License

Copyright (c) ${holders}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const BSD_3 = (holders) => `BSD 3-Clause License

Copyright (c) ${holders}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

/** A package: what it is, where it comes from, and its license files' texts. */
const packages = [];

const normalize = (text) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();

/**
 * The texts of a package's license files. Where it offers MIT as one choice
 * ("MIT OR Apache-2.0") and ships it on its own, MIT is the one taken.
 */
function licenseTexts(dir, license) {
  let names = readdirSync(dir).filter((name) => LICENSE_FILE.test(name) && !name.endsWith(".rs") && !name.endsWith(".js"));
  const choice = !/\bAND\b/.test(license) && /(^|[\s(/])MIT($|[\s)/])/.test(license);
  if (choice && names.some((name) => /mit/i.test(name))) names = names.filter((name) => /mit|notice|copyright/i.test(name));
  return names.sort().map((name) => normalize(readFileSync(join(dir, name), "utf8")));
}

/** The standard text of the first license of `expression` there is one for: MIT, BSD-3-Clause, or another package's file. */
function standardText(expression, holders) {
  const ids = expression
    .split(/\s+(?:OR|AND)\s+|\/|[()]/)
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.includes("MIT")) return MIT(holders);
  if (ids.includes("BSD-3-Clause")) return BSD_3(holders);
  for (const id of ids) {
    const other = packages.find((p) => p.license === id && p.texts.length === 1);
    if (other) return other.texts[0];
  }
  throw new Error(`no license text for ${expression}`);
}

// --- npm ------------------------------------------------------------------

const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));

/** The folder npm installed `name` in for a package in `from`, as Node resolves it. */
function resolve(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(dir) === dir) return null;
  }
}

const npmSeen = new Set();
function addNpm(name, from, withDependencies) {
  const dir = resolve(name, from);
  if (!dir || npmSeen.has(dir)) return;
  npmSeen.add(dir);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const license = typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "UNKNOWN");
  const repository = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
  packages.push({
    kind: "npm",
    name: pkg.name,
    version: pkg.version,
    license,
    source: repository ?? pkg.homepage ?? `https://www.npmjs.com/package/${pkg.name}`,
    texts: licenseTexts(dir, license),
    holders: author ?? pkg.name,
  });
  if (!withDependencies) return;
  // Optional dependencies are native builds for Node (pdf.js' canvas); the webview bundle has none.
  for (const dependency of Object.keys(pkg.dependencies ?? {})) addNpm(dependency, dir, true);
}

for (const name of [...Object.keys(manifest.dependencies ?? {}), ...BUNDLED_TOOLS]) addNpm(name, repo, true);
for (const name of RUNTIME_ONLY) addNpm(name, repo, false);

// --- Rust -----------------------------------------------------------------

const tauri = join(repo, "src-tauri");
const host = /^host: (.+)$/m.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))[1].trim();
const metadata = JSON.parse(
  execFileSync("cargo", ["metadata", "--format-version", "1", "--filter-platform", host], {
    cwd: tauri,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  }),
);
const crates = new Map(metadata.packages.map((p) => [p.id, p]));
const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
const reached = new Set();
const stack = [metadata.resolve.root];
while (stack.length) {
  const id = stack.pop();
  if (reached.has(id)) continue;
  reached.add(id);
  // Normal dependencies; build scripts' and tests' do not end up in the program.
  for (const dependency of nodes.get(id).deps) if (dependency.dep_kinds.some((k) => k.kind === null)) stack.push(dependency.pkg);
}
reached.delete(metadata.resolve.root);
for (const id of reached) {
  const crate = crates.get(id);
  const dir = dirname(crate.manifest_path);
  const texts = licenseTexts(dir, crate.license ?? "");
  if (crate.license_file && existsSync(join(dir, crate.license_file)))
    texts.push(normalize(readFileSync(join(dir, crate.license_file), "utf8")));
  packages.push({
    kind: "rust",
    name: crate.name,
    version: crate.version,
    license: crate.license ?? "SEE LICENSE FILE",
    source: crate.repository ?? `https://crates.io/crates/${crate.name}`,
    texts: [...new Set(texts)],
    holders: crate.authors.length ? crate.authors.map((a) => a.replace(/\s*<[^>]*>/, "")).join(", ") : `the ${crate.name} authors`,
  });
}
const webview2 = [...reached].map((id) => crates.get(id)).find((c) => c.name === "webview2-com-sys");

// --- Without a license file -----------------------------------------------

for (const p of packages.filter((p) => !p.texts.length)) {
  p.texts = [standardText(p.license, p.holders)];
  console.warn(`${p.name} ${p.version}: no license file, the standard ${p.license} text with "${p.holders}"`);
}

// --- The file -------------------------------------------------------------

const rule = "=".repeat(80);
const thin = "-".repeat(80);
const sections = [];

/** Packages by the texts they ship, so each text stands once. */
function grouped(list) {
  const groups = new Map();
  for (const p of list.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))) {
    // The same text laid out differently (line breaks, indents) counts as one.
    const text = p.texts.join("\n\n" + thin + "\n\n");
    const key = text.replace(/\s+/g, " ");
    (groups.get(key) ?? groups.set(key, { text, members: [] }).get(key)).members.push(p);
  }
  return [...groups.values()].map(({ text, members }) =>
    [...members.map((p) => `${p.name} ${p.version} (${p.license})\n  ${p.source.replace(/^git\+/, "")}`), "", text].join("\n"),
  );
}

const unicodeText = packages.find((p) => p.license === "Unicode-3.0" && p.texts.length)?.texts[0];
if (!unicodeText) throw new Error("no Unicode-3.0 license text among the crates");

sections.push(`Gilgamesh includes the following material made by others, under the
licenses given with it. Gilgamesh itself is not covered by these licenses.

Not part of the app, and so not listed here: the TeX distribution (TinyTeX,
TeX Live) and the spelling dictionaries, which Gilgamesh downloads only when
asked to, from their publishers and under their own licenses
(https://tug.org/texlive/copying.html; the dictionary-<language> packages at
https://www.npmjs.com).`);

// The MPL asks where the source of the program's MPL-covered parts is to be had.
const mpl = packages.filter((p) => /\bMPL-2\.0\b/.test(p.license)).sort((a, b) => a.name.localeCompare(b.name));
if (mpl.length) {
  sections.push(`The following components are covered by the Mozilla Public License 2.0.
Their source code is available, unchanged, from the addresses given:

${mpl.map((p) => `  ${p.name} ${p.version}: ${p.source.replace(/^git\+/, "")} (https://crates.io/crates/${p.name}/${p.version})`).join("\n")}`);
}

sections.push(`${rule}
DATA
${rule}

Unicode Character Database
  https://www.unicode.org/ucd/
  The names of the characters in the symbol dialog are taken from
  UnicodeData.txt.

${unicodeText}

The symbol dialog also lists the names of LaTeX commands, from the LaTeX
kernel, amsfonts and unicode-math (LaTeX Project Public License 1.3c); none of
their files is part of the app.`);

if (webview2) {
  sections.push(`${rule}
MICROSOFT WEBVIEW2 SDK
${rule}

WebView2LoaderStatic.lib, linked into the program by webview2-com-sys ${webview2.version}
  https://aka.ms/webview2

${normalize(readFileSync(join(notices, "webview2-sdk-license.txt"), "utf8"))}

${thin}

${normalize(readFileSync(join(notices, "webview2-sdk-notice.txt"), "utf8"))}`);
}

const npm = packages.filter((p) => p.kind === "npm");
const rust = packages.filter((p) => p.kind === "rust");
sections.push(`${rule}
JAVASCRIPT PACKAGES (${npm.length})
${rule}

${grouped(npm).join(`\n\n${thin}\n\n`)}`);
sections.push(`${rule}
RUST CRATES (${rust.length})
${rule}

${grouped(rust).join(`\n\n${thin}\n\n`)}`);

writeFileSync(output, `${sections.join("\n\n\n")}\n`);
console.log(`wrote ${output}: ${npm.length} npm packages, ${rust.length} crates`);
