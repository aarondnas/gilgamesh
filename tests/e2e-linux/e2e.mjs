// End-to-end test of Gilgamesh on Linux; started by run.sh, which sets up the world.
//
// Drives the app through tauri-driver (W3C WebDriver over HTTP, no client library)
// and checks every result where it lands: files, Git repositories, printer output,
// assistant configurations, the TeX installation. Native GTK message boxes are
// answered through AT-SPI (answer-dialog.py), as a user would click them.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const { APP, T, REAL_HOME, MESSAGES, FRESH_TEX, BUNDLE, LAUNCHED } = process.env;
const HOME = process.env.HOME;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DRIVER = "http://127.0.0.1:4444";
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";
const PROJECT = "Paper";
const ROOT = path.join(T, "projects", PROJECT);
const TEXBIN = path.join(HOME, ".local/share/com.aaron.gilgamesh/tex/distribution/bin/x86_64-linux");
const only = process.argv.slice(2);

const messages = JSON.parse(fs.readFileSync(MESSAGES, "utf8"));
const m = (key, params = {}) => {
  let text = messages[key];
  if (typeof text !== "string") throw new Error(`message ${key} is not a plain string`);
  for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, v);
  return text;
};
const lit = (s) => (s.includes("'") ? `concat('${s.split("'").join(`', "'", '`)}')` : `'${s}'`);

// ------------------------------------------------------------------ WebDriver

let session;
async function wd(method, url, body) {
  const res = await fetch(`${DRIVER}/session${session ? `/${session}` : ""}${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url}: ${json.value?.error} ${json.value?.message ?? ""}`.trim());
  return json.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exec = (script, ...args) => wd("POST", "/execute/sync", { script, args });
const execAsync = (script, ...args) => wd("POST", "/execute/async", { script, args });

/** Laid out and not hidden (WebKitWebDriver has no "is displayed"). */
const visible = (id) =>
  exec(
    `const e = arguments[0]; const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
     return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";`,
    { [ELEMENT]: id },
  ).catch(() => false);
async function findAll(xpath) {
  return (await wd("POST", "/elements", { using: "xpath", value: xpath })).map((e) => e[ELEMENT]);
}
/** The first element that is shown; waits for it. */
async function find(xpath, timeout = 15000) {
  return waitFor(
    async () => {
      for (const id of await findAll(xpath)) {
        if (await visible(id)) return id;
      }
      return null;
    },
    timeout,
    `element ${xpath}`,
  );
}
async function waitFor(check, timeout = 15000, what = "condition") {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const value = await check();
      if (value) return value;
    } catch (e) {
      last = e;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}${last ? ` (${last.message})` : ""}`);
}
async function click(xpath, timeout = 15000) {
  const id = await find(xpath, timeout);
  await waitFor(() => exec("return !arguments[0].disabled", { [ELEMENT]: id }), timeout, `${xpath} enabled`);
  try {
    await wd("POST", `/element/${id}/click`, {});
  } catch (e) {
    // Covered for a moment by an animation: click it as the page would.
    if (!/intercept|not interactable/i.test(e.message)) throw e;
    await exec("arguments[0].click()", { [ELEMENT]: id });
  }
  return id;
}
async function type(xpath, text, { clear = true } = {}) {
  const id = await find(xpath);
  if (clear) await wd("POST", `/element/${id}/clear`, {});
  await wd("POST", `/element/${id}/value`, { text });
  return id;
}
/** Real key presses at the focus: each entry a key, or an array pressed together (a chord). */
async function pressKeys(keys) {
  const actions = [];
  for (const key of keys) {
    const chord = Array.isArray(key) ? key : [key];
    for (const k of chord) actions.push({ type: "keyDown", value: k });
    for (const k of [...chord].reverse()) actions.push({ type: "keyUp", value: k });
  }
  await wd("POST", "/actions", { actions: [{ type: "key", id: "keyboard", actions }] });
  await wd("DELETE", "/actions");
}
const textOf = async (xpath) => wd("GET", `/element/${await find(xpath)}/text`);
const exists = async (xpath) => {
  for (const id of await findAll(xpath)) if (await visible(id)) return true;
  return false;
};
const button = (label) => `//button[normalize-space(.)=${lit(label)} or @title=${lit(label)} or @aria-label=${lit(label)}]`;
async function screenshot(name) {
  const png = await wd("GET", "/screenshot").catch(() => null);
  if (png) fs.writeFileSync(path.join(T, "shots", `${name}.png`), Buffer.from(png, "base64"));
}

// ------------------------------------------------------------------ helpers

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", ...opts }).trim();
const git = (dir, ...args) => sh("git", ["-C", dir, ...args]);
const gitBare = (repo, ...args) => sh("git", [`--git-dir=${path.join(T, "remote", repo)}`, ...args]);
const kpsewhich = (file) => {
  try {
    return sh(path.join(TEXBIN, "kpsewhich"), [file]);
  } catch {
    return "";
  }
};
function assert(cond, message) {
  if (!cond) throw new Error(`assertion failed: ${message}`);
}
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/**
 * Answers the app's next native (GTK) message box through AT-SPI, as a user would,
 * clicking the first of `labels` it offers; resolves to its title, text and buttons.
 */
function answerDialog(labels, timeoutSeconds = 60) {
  const script = path.join(path.dirname(new URL(import.meta.url).pathname), "answer-dialog.py");
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [script, labels.join(","), String(timeoutSeconds)], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      const answer = out.trim() ? JSON.parse(out.trim().split("\n").pop()) : {};
      code === 0 ? resolve(answer) : reject(new Error(`native dialog: ${out.trim() || err.trim()}`));
    });
  });
}

async function openFile(section) {
  if (!(await exists(`//nav[contains(@class,'nav')]`))) await click(button(m("tab_file")));
  await click(`//nav//button[contains(@class,'item')][normalize-space(.)=${lit(section)}]`);
}
async function leaveFile() {
  if (await exists(button(m("file_back")))) await click(button(m("file_back")));
  await waitFor(async () => !(await exists(`//nav[contains(@class,'nav')]//button[contains(@class,'item')]`)), 5000, "file view closed");
}
async function waitCompiled(timeout = 180000) {
  return waitFor(
    async () => {
      const status = await exec(`return document.body.innerText`);
      if (status.includes(m("status_compiling"))) return null;
      const match = status.match(new RegExp(m("status_compiled", { seconds: "([0-9.,]+)" })));
      return match ? match[0] : null;
    },
    timeout,
    "a finished build",
  );
}
async function showGitView() {
  for (let i = 0; i < 3 && !(await exists(`//textarea[@placeholder=${lit(m("git_commit_placeholder"))}]`)); i++) {
    await click(button(m("sidebar_previous_view")));
    await sleep(400);
  }
  await find(`//textarea[@placeholder=${lit(m("git_commit_placeholder"))}]`);
}
async function editorText() {
  return exec(`return [...document.querySelectorAll('.cm-content')].map(e => e.innerText).join('\\n')`);
}

// ------------------------------------------------------------------ MCP client

class Mcp {
  constructor(command, args, env = process.env) {
    this.child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = "";
    this.child.stderr.on("data", (d) => (this.stderr += d));
    readline.createInterface({ input: this.child.stdout }).on("line", (line) => {
      const msg = JSON.parse(line);
      const waiting = this.pending.get(msg.id);
      if (waiting) {
        this.pending.delete(msg.id);
        waiting(msg);
      }
    });
  }
  request(method, params = {}, timeout = 300000) {
    const id = this.nextId++;
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP ${method} timed out; stderr: ${this.stderr}`)), timeout);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        msg.error ? reject(new Error(`MCP ${method}: ${JSON.stringify(msg.error)}`)) : resolve(msg.result);
      });
    });
  }
  notify(method, params = {}) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  /** A tool's text and whether it failed. */
  async call(name, args = {}) {
    const result = await this.request("tools/call", { name, arguments: args });
    return { text: result.content.map((c) => c.text).join("\n"), isError: !!result.isError };
  }
  async ok(name, args = {}) {
    const r = await this.call(name, args);
    if (r.isError) throw new Error(`${name} failed: ${r.text}`);
    return r.text;
  }
  close() {
    this.child.stdin.end();
    this.child.kill();
  }
}

// ------------------------------------------------------------------ tests

const results = [];
async function test(name, fn) {
  if (only.length && !only.some((o) => name.toLowerCase().includes(o.toLowerCase()))) return;
  const start = Date.now();
  process.stdout.write(`▶ ${name} … `);
  try {
    const note = await fn();
    results.push({ name, ok: true, note });
    console.log(`ok (${((Date.now() - start) / 1000).toFixed(1)} s)${note ? ` — ${note}` : ""}`);
  } catch (e) {
    results.push({ name, ok: false, note: e.message });
    console.log(`FAILED (${((Date.now() - start) / 1000).toFixed(1)} s)\n    ${e.message}`);
    await screenshot(name.replace(/[^a-z0-9]+/gi, "_"));
  }
}

/** Picks packages that are in TeX Live but not in this installation. */
function missingPackages(candidates) {
  return candidates.filter(([, file]) => !kpsewhich(file));
}

async function main() {
  session = (
    await wd("POST", "", {
      capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: APP } } },
    })
  ).sessionId;
  try {
    await run();
  } finally {
    await screenshot("zz_final");
    await wd("DELETE", "").catch(() => {});
  }
}

async function run() {
  await find(button(m("start_new")), 30000);

  // ---------------------------------------------------------- TeX distribution
  if (FRESH_TEX) {
    await test("TeX: install TinyTeX from the Packages page, as on a fresh system", async () => {
      assert(!kpsewhich("article.cls"), "no TeX before the test");
      await openFile(m("tab_settings"));
      await click(`//button[@role='tab'][normalize-space(.)=${lit(m("ribbon_packages"))}]`);
      await find(`//h1[normalize-space(.)=${lit(m("setup_title"))}]`);
      const chosen = await exec("return document.querySelector('input[name=bundle]:checked')?.value");
      assert(chosen === "TinyTeX-1", `standard bundle preselected: ${chosen}`);
      await click(`//section[contains(@class,'setup')]//button[normalize-space(.)=${lit(m("setup_install"))}]`);
      // Download, unpack, configure: then the catalog takes the setup's place.
      await find(`//input[@type='search']`, 20 * 60000);
      await waitFor(async () => (await findAll(`//tr[td[contains(@class,'name')]]`)).length > 100, 120000, "the package catalog");
      const manifest = readJson(path.join(HOME, ".local/share/com.aaron.gilgamesh/tex/manifest.json"));
      assert(kpsewhich("article.cls"), "article.cls found");
      const summary = await exec(`return document.querySelector('.summary')?.innerText`);
      await leaveFile();
      return `TinyTeX ${manifest.version} (${manifest.bundle}); ${summary}`;
    });
  }

  const [pkgUi, pkgAuto, pkgMcp] = missingPackages([
    ["blindtext", "blindtext.sty"],
    ["lipsum", "lipsum.sty"],
    ["kantlipsum", "kantlipsum.sty"],
    ["epigraph", "epigraph.sty"],
    ["dashrule", "dashrule.sty"],
    ["fancyhdr", "fancyhdr.sty"],
    ["pdflscape", "pdflscape.sty"],
  ]);
  console.log(`packages for the tests: ${pkgUi?.[0]}, ${pkgAuto?.[0]}, ${pkgMcp?.[0]}`);

  // ---------------------------------------------------------- project + Git
  await test("New project with Git repository, published to the server", async () => {
    await click(button(m("start_new")));
    await click(`//button[contains(@class,'template')][.//strong[normalize-space(.)=${lit(m("template_article"))}]]`);
    await type(`//dialog[@open]//input[@placeholder=${lit(m("new_project_name_placeholder"))}]`, PROJECT);
    await click(`//dialog[@open]//label[contains(normalize-space(.),${lit(m("git_init_title"))})]/input`);
    await type(`//dialog[@open]//input[@placeholder=${lit(m("git_url_placeholder"))}]`, "git://127.0.0.1/paper.git");
    // A fresh system: Git knows no one yet, so the dialog asks.
    await type(
      `//dialog[@open]//fieldset[contains(@class,'identity')]//label[span[normalize-space(.)=${lit(m("git_identity_name"))}]]/input`,
      "Test Author",
    );
    await type(
      `//dialog[@open]//fieldset[contains(@class,'identity')]//label[span[normalize-space(.)=${lit(m("git_identity_email"))}]]/input`,
      "author@example.com",
    );
    await click(`//dialog[@open]//button[@type='submit']`);
    await find(`//div[contains(@class,'cm-content')]`, 60000);
    await waitFor(async () => !(await exists(`//dialog[@open]`)), 30000, "dialog closed");
    assert(fs.existsSync(path.join(ROOT, ".git")), "repository created");
    const log = git(ROOT, "log", "--format=%an <%ae> %s");
    assert(log === `Test Author <author@example.com> ${m("git_first_commit")}`, `first commit: ${log}`);
    assert(sh("git", ["config", "--global", "user.name"]) === "Test Author", "identity saved globally");
    const remote = gitBare("paper.git", "log", "--format=%s", "main");
    assert(remote === m("git_first_commit"), `published: ${remote}`);
    return `files: ${git(ROOT, "ls-files").split("\n").join(", ")}`;
  });

  await test("Compile the new project", async () => {
    // Opening compiles; if not, the ribbon button does.
    const status = await waitCompiled(30000).catch(async () => {
      await click(button(m("ribbon_compile")));
      return waitCompiled();
    });
    await find(`//canvas`, 30000);
    return status;
  });

  await test("Git view: change, commit all, publish (sync)", async () => {
    await showGitView();
    assert(await exists(`//*[contains(normalize-space(.),${lit(m("git_no_changes"))})]`), "clean after creation");
    // A change typed in the editor, at the end of the document.
    await click(`//div[contains(@class,'cm-content')]`);
    await pressKeys([["\uE009", "\uE010"]]); // Ctrl+End
    await pressKeys(["\uE007", ..."% typed by the UI test"]);
    await waitFor(() => fs.readFileSync(path.join(ROOT, "main.tex"), "utf8").includes("typed by the UI test"), 15000, "saved to disk");
    await find(`//span[contains(@class,'kind') and normalize-space(.)='M']`, 10000);
    await type(`//textarea[@placeholder=${lit(m("git_commit_placeholder"))}]`, "Edit from the UI");
    await click(button(m("git_commit_all")));
    await waitFor(() => git(ROOT, "log", "-1", "--format=%s") === "Edit from the UI", 15000, "commit");
    // One commit ahead: Sync replaces Commit.
    await click(`//button[contains(normalize-space(.),${lit(m("git_sync"))})]`, 10000);
    await waitFor(() => gitBare("paper.git", "log", "-1", "--format=%s", "main") === "Edit from the UI", 30000, "push");
    return git(ROOT, "status", "-sb").split("\n")[0];
  });

  await test("Git view: sync merges a commit from elsewhere", async () => {
    const other = path.join(T, "other-clone");
    sh("git", ["clone", "-q", path.join(T, "remote", "paper.git"), other]);
    fs.writeFileSync(path.join(other, "notes.txt"), "from another computer\n");
    git(other, "add", "notes.txt");
    git(other, "-c", "user.name=Other", "-c", "user.email=o@example.com", "commit", "-qm", "Notes from elsewhere");
    git(other, "push", "-q");
    // A local change and commit, so the branches diverge.
    fs.appendFileSync(path.join(ROOT, "main.tex"), "% second local change\n");
    await find(`//span[contains(@class,'kind') and normalize-space(.)='M']`, 15000);
    await type(`//textarea[@placeholder=${lit(m("git_commit_placeholder"))}]`, "Second local change");
    await click(button(m("git_commit_all")));
    await click(`//button[contains(normalize-space(.),${lit(m("git_sync"))})]`, 15000);
    await waitFor(() => fs.existsSync(path.join(ROOT, "notes.txt")), 30000, "pulled file");
    await waitFor(() => gitBare("paper.git", "log", "-1", "--format=%s", "main").startsWith("Merge"), 30000, "merge pushed");
    await find(`//*[contains(normalize-space(.),${lit(m("git_no_changes"))})]`, 10000);
    return gitBare("paper.git", "log", "--oneline", "main").split("\n").length + " commits on the server";
  });

  // ---------------------------------------------------------- packages
  await test("Package manager: install a package from the catalog", async () => {
    assert(pkgUi, "a package that is not installed yet");
    const [name, file] = pkgUi;
    await openFile(m("tab_settings"));
    await click(`//button[@role='tab'][normalize-space(.)=${lit(m("ribbon_packages"))}]`);
    await type(`//input[@type='search']`, name);
    const row = `//tr[td[contains(@class,'name') and normalize-space(.)=${lit(name)}]]`;
    await click(`${row}//button[normalize-space(.)=${lit(m("package_install"))}]`, 60000);
    await find(`${row}//*[contains(@class,'badge')]`, 180000);
    assert(kpsewhich(file), `${file} found by kpsewhich`);
    return `${name} → ${kpsewhich(file)}`;
  });

  await test("Package manager: remove the package again", async () => {
    assert(pkgUi, "a package installed by the previous test");
    const [name, file] = pkgUi;
    const row = `//tr[td[contains(@class,'name') and normalize-space(.)=${lit(name)}]]`;
    const dialog = answerDialog(["Yes", "OK", "Ok"]);
    await click(`${row}//button[normalize-space(.)=${lit(m("package_remove"))}]`);
    const asked = await dialog;
    assert(
      asked.text.some((t) => t.includes(name)),
      `confirmation names the package: ${JSON.stringify(asked)}`,
    );
    await find(`${row}//button[normalize-space(.)=${lit(m("package_install"))}]`, 120000);
    assert(!kpsewhich(file), `${file} gone`);
    return `confirmed “${asked.title}” with ${asked.clicked} (buttons: ${asked.buttons.join(", ")})`;
  });

  // ---------------------------------------------------------- printing
  /** Prints with the settings shown and returns the PDF the CUPS PDF printer wrote. */
  async function printAndCollect() {
    const outDir = path.join(REAL_HOME, "PDF");
    const before = new Set(fs.existsSync(outDir) ? fs.readdirSync(outDir) : []);
    await waitFor(
      async () => !(await findAll(`//button[contains(@class,'print-button')][@disabled]`)).length,
      60000,
      "print button enabled",
    );
    await click(`//button[contains(@class,'print-button')]`);
    const status = await waitFor(
      async () => {
        const text = await textOf(`//aside//p[contains(@class,'status')]`).catch(() => "");
        return text && !text.includes("…") ? text : null;
      },
      60000,
      "print result",
    );
    assert(status === m("print_done", { printer: "PDF" }), `status: ${status}`);
    const printed = await waitFor(
      () => {
        const fresh = fs.readdirSync(outDir).filter((f) => !before.has(f));
        return fresh.length ? path.join(outDir, fresh[0]) : null;
      },
      60000,
      "cups-pdf output",
    );
    // cups-pdf writes the file in steps.
    let size = -1;
    await waitFor(
      () => {
        const now = fs.statSync(printed).size;
        const stable = now > 0 && now === size;
        size = now;
        return stable;
      },
      30000,
      "complete output",
    );
    return printed;
  }
  const pageCount = (pdf) => Number(sh("pdfinfo", [pdf]).match(/Pages:\s+(\d+)/)[1]);
  /**
   * A page as the printer would put it on paper (rotation applied): its size in
   * pixels and the box around its ink, as fractions of the page.
   */
  function inkBox(pdf, page) {
    const prefix = path.join(T, `ink-${path.basename(pdf, ".pdf")}-${page}`);
    sh("pdftoppm", ["-gray", "-r", "36", "-f", String(page), "-l", String(page), "-singlefile", pdf, prefix]);
    const data = fs.readFileSync(`${prefix}.pgm`);
    const header = data.toString("latin1", 0, 64).match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
    const [w, h] = [Number(header[1]), Number(header[2])];
    const pixels = data.subarray(header[0].length);
    let [x0, y0, x1, y1, left, right] = [w, h, -1, -1, 0, 0];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (pixels[y * w + x] < 200) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
          if (x < w / 2) left++;
          else right++;
        }
      }
    }
    const f = (v) => Math.round(v * 1000) / 1000;
    return { w, h, x0: f(x0 / w), y0: f(y0 / h), x1: f(x1 / w), y1: f(y1 / h), left, right };
  }
  const builtPdf = () => {
    const found = sh("find", [path.join(HOME, ".local/share/com.aaron.gilgamesh"), "-name", "main.pdf", "-printf", "%T@ %p\n"])
      .split("\n")
      .filter(Boolean)
      .sort()
      .pop();
    return found?.split(" ").slice(1).join(" ");
  };

  await test("Print: three pages, one per sheet, match the compiled PDF", async () => {
    // Three pages, so sheet breaks show up.
    const file = path.join(ROOT, "main.tex");
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes("Third page")) {
      fs.writeFileSync(file, text.replace("\\end{document}", "\\newpage\nSecond page.\n\\newpage\nThird page.\n\\end{document}"));
    }
    await waitFor(() => builtPdf() && pageCount(builtPdf()) === 3, 120000, "a three-page build");
    await openFile(m("file_print"));
    await find(`//aside//select[option[normalize-space(.)=${lit(m("print_printer_default", { name: "PDF" }))}]]`, 15000);
    await find(`//*[contains(normalize-space(.), 'of 3')]`, 30000);
    const printed = await printAndCollect();
    assert(pageCount(printed) === 3, `pages printed: ${pageCount(printed)}`);
    const original = inkBox(builtPdf(), 1);
    const paper = inkBox(printed, 1);
    assert(paper.h > paper.w, `portrait paper: ${paper.w}×${paper.h}`);
    // Same place on paper as in the PDF, within 2 % of the page.
    for (const k of ["x0", "y0", "x1", "y1"]) {
      assert(Math.abs(original[k] - paper[k]) < 0.02, `page 1 ${k}: PDF ${original[k]}, printed ${paper[k]}`);
    }
    const third = inkBox(printed, 3);
    assert(third.left + third.right > 0, "page 3 has ink");
    return `${path.basename(printed)}: 3 pages; ink box PDF ${JSON.stringify([original.x0, original.y0, original.x1, original.y1])} = printed ${JSON.stringify([paper.x0, paper.y0, paper.x1, paper.y1])}`;
  });

  await test("Print: two pages per sheet (landscape), grayscale, one-sided", async () => {
    const perSheet = await find(`//aside//select[option[normalize-space(.)=${lit(m("print_one_per_sheet"))}]]`);
    await exec(`const s = arguments[0]; s.value = s.options[1].value; s.dispatchEvent(new Event('change', {bubbles:true}));`, {
      [ELEMENT]: perSheet,
    });
    const color = await find(`//aside//select[option[normalize-space(.)=${lit(m("print_grayscale"))}]]`);
    await exec(`const s = arguments[0]; s.selectedIndex = 1; s.dispatchEvent(new Event('change', {bubbles:true}));`, { [ELEMENT]: color });
    const twoSided = await find(`//label[contains(normalize-space(.),${lit(m("print_two_sided"))})]/input`);
    const checked = () => exec("return arguments[0].checked", { [ELEMENT]: twoSided });
    if (await checked()) await click(`//label[contains(normalize-space(.),${lit(m("print_two_sided"))})]/input`);
    await waitFor(async () => !(await checked()), 5000, "one-sided");
    await screenshot("print_preview_2up");
    const printed = await printAndCollect();
    assert(pageCount(printed) === 2, `sheets printed: ${pageCount(printed)}`);
    const first = inkBox(printed, 1);
    assert(first.w > first.h, `landscape sheet: ${first.w}×${first.h}`);
    assert(first.left > 20 && first.right > 5, `both halves of sheet 1 carry a page: ${first.left}/${first.right}`);
    const second = inkBox(printed, 2);
    assert(second.left > 5 && second.right === 0, `sheet 2 carries page 3 on its left half only: ${second.left}/${second.right}`);
    return `${path.basename(printed)}: 2 landscape sheets, ink ${first.left}/${first.right} and ${second.left}/${second.right}`;
  });

  await test("Print: “Add printer …” opens the system's printer settings, else CUPS in the browser", async () => {
    // run.sh puts stand-ins for the settings programs and URL openers first on the PATH; each logs its call.
    const log = () => (fs.existsSync(LAUNCHED) ? fs.readFileSync(LAUNCHED, "utf8") : "");
    let mark = log().length;
    await click(button(m("print_add_printer")));
    const settings = await waitFor(() => log().slice(mark).trim() || null, 10000, "printer settings started");
    assert(settings.startsWith("system-config-printer"), `started: ${settings}`);
    // Without a settings program, the web interface every CUPS serves.
    const programs = ["system-config-printer", "gnome-control-center", "systemsettings", "kcmshell5", "kcmshell6"].map((p) =>
      path.join(T, "fakebin", p),
    );
    for (const p of programs) fs.renameSync(p, `${p}.off`);
    try {
      mark = log().length;
      await click(button(m("print_add_printer")));
      const opened = await waitFor(() => log().slice(mark).trim() || null, 10000, "the CUPS web interface opened");
      assert(opened.includes("http://localhost:631/printers/"), `opened: ${opened}`);
      return `${settings}; then ${opened.split("\n")[0]}`;
    } finally {
      for (const p of programs) fs.renameSync(`${p}.off`, p);
    }
  });

  // ---------------------------------------------------------- AI
  let exe;
  await test("AI page: connect Claude Desktop, Claude Code and Codex", async () => {
    await openFile(m("ribbon_assistant"));
    const card = (name) => `//div[contains(@class,'card')][h2[normalize-space(.)=${lit(name)}] or .//h2[normalize-space(.)=${lit(name)}]]`;
    await click(`${card("Claude Desktop")}//button[normalize-space(.)=${lit(m("assistant_connect_desktop"))}]`);
    await find(`${card("Claude Desktop")}//p[contains(@class,'note')]`, 15000);
    await click(`${card("Claude Code")}//button[normalize-space(.)=${lit(m("assistant_connect_code"))}]`);
    await find(`${card("Claude Code")}//p[contains(@class,'note')]`, 15000);
    await click(`${card("Codex")}//button[normalize-space(.)=${lit(m("assistant_connect_codex"))}]`);
    await find(`${card("Codex")}//p[contains(@class,'note')]`, 15000);
    for (const name of ["Claude Desktop", "Claude Code", "Codex"]) {
      await find(`${card(name)}//*[contains(@class,'connected')]`, 10000);
    }
    const desktop = readJson(path.join(HOME, ".config/Claude/claude_desktop_config.json"));
    assert(desktop.mcpServers.other && desktop.preferences?.keep === 1, "Claude Desktop: other entries kept");
    exe = desktop.mcpServers.gilgamesh?.command;
    assert(
      exe && desktop.mcpServers.gilgamesh.args?.[0] === "--mcp",
      `Claude Desktop entry: ${JSON.stringify(desktop.mcpServers.gilgamesh)}`,
    );
    const code = readJson(path.join(HOME, ".claude.json"));
    assert(code.mcpServers.other && code.mcpServers.gilgamesh?.command === exe, `Claude Code entry: ${JSON.stringify(code.mcpServers)}`);
    const toml = fs.readFileSync(path.join(HOME, ".codex/config.toml"), "utf8");
    assert(
      toml.includes("[mcp_servers.other]") && toml.includes(`[mcp_servers.gilgamesh]\ncommand = ${JSON.stringify(exe)}`),
      `Codex config:\n${toml}`,
    );
    // Connecting again replaces, it does not duplicate.
    await click(`${card("Codex")}//button[normalize-space(.)=${lit(m("assistant_reconnect"))}]`);
    await sleep(1500);
    const again = fs.readFileSync(path.join(HOME, ".codex/config.toml"), "utf8");
    assert(again.split("[mcp_servers.gilgamesh]").length === 2, "one Gilgamesh table after reconnecting");
    return `server command: ${exe}`;
  });

  await test("MCP: an assistant reads, edits, compiles and installs through the bridge", async () => {
    exe ??= APP;
    await leaveFile();
    const mcp = new Mcp(exe, ["--mcp"]);
    try {
      const init = await mcp.request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "e2e", version: "1" },
      });
      mcp.notify("notifications/initialized");
      const tools = (await mcp.request("tools/list")).tools.map((t) => t.name);
      assert(tools.length >= 20, `tools: ${tools}`);
      const project = await mcp.ok("get_project");
      assert(project.includes("main.tex"), `get_project: ${project.slice(0, 200)}`);
      const main = await mcp.ok("read_file", { path: "main.tex" });
      assert(main.includes("\\begin{document}"), "read_file");
      // An edit that needs a package this TeX lacks: compiling installs it (auto-install is on).
      const [autoName, autoFile] = pkgAuto ?? ["", ""];
      const anchor = "\\begin{document}";
      await mcp.ok("edit_file", {
        path: "main.tex",
        old_text: anchor,
        new_text: `${anchor}\nInserted by the assistant.${autoName === "lipsum" ? "\n\\lipsum[1]" : ""}`,
      });
      if (autoName) {
        const preamble = (await mcp.ok("read_file", { path: "main.tex" })).match(/\\documentclass[^\n]*\n/)[0];
        await mcp.ok("edit_file", { path: "main.tex", old_text: preamble, new_text: `${preamble}\\usepackage{${autoName}}\n` });
      }
      await waitFor(async () => (await editorText()).includes("Inserted by the assistant."), 10000, "edit shown in the editor");
      const review = await mcp.ok("get_review");
      assert(/main\.tex/.test(review), `get_review: ${review}`);
      const compiled = await mcp.call("compile");
      assert(!compiled.isError, `compile: ${compiled.text}`);
      if (autoName) {
        await waitFor(() => kpsewhich(autoFile), 180000, `${autoName} installed on demand`);
        await waitCompiled(180000);
      }
      const problems = await mcp.ok("get_problems");
      const search = await mcp.ok("search", { query: "Inserted by the assistant" });
      assert(search.includes("main.tex"), `search: ${search}`);
      const outline = await mcp.ok("get_outline");
      // New file, undo, redo, rename, delete.
      await mcp.ok("write_file", { path: "chapters/extra.tex", content: "Extra chapter.\n" });
      assert(fs.existsSync(path.join(ROOT, "chapters/extra.tex")), "write_file on disk");
      await mcp.ok("rename_file", { path: "chapters/extra.tex", new_path: "chapters/appendix.tex" });
      assert(fs.existsSync(path.join(ROOT, "chapters/appendix.tex")), "rename_file on disk");
      await mcp.ok("delete_file", { path: "chapters/appendix.tex" });
      assert(!fs.existsSync(path.join(ROOT, "chapters/appendix.tex")), "delete_file on disk");
      await mcp.ok("edit_file", {
        path: "main.tex",
        old_text: "Inserted by the assistant.",
        new_text: "Inserted by the assistant, then undone.",
      });
      await mcp.ok("undo");
      await waitFor(() => !fs.readFileSync(path.join(ROOT, "main.tex"), "utf8").includes("then undone"), 10000, "undo on disk");
      await mcp.ok("redo");
      await waitFor(() => fs.readFileSync(path.join(ROOT, "main.tex"), "utf8").includes("then undone"), 10000, "redo on disk");
      // Packages directly.
      if (pkgMcp) {
        await mcp.ok("install_packages", { names: [pkgMcp[0]] });
        assert(kpsewhich(pkgMcp[1]), `${pkgMcp[0]} installed by install_packages`);
      }
      const settingsText = await mcp.ok("get_settings");
      return `protocol ${init.protocolVersion}, ${tools.length} tools; auto-installed ${autoName || "–"}; problems: ${problems.split("\n")[0].slice(0, 60)}; settings ${settingsText.length} chars; outline ${outline.length} chars`;
    } finally {
      mcp.close();
    }
  });

  await test("MCP: Git commit waits for review, then commits and syncs", async () => {
    const mcp = new Mcp(exe ?? APP, ["--mcp"]);
    try {
      await mcp.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
      const status = await mcp.ok("git_status");
      assert(/main\.tex/.test(status), `git_status: ${status}`);
      const refused = await mcp.call("git_commit", { message: "AI commit" });
      assert(refused.isError, `git_commit must refuse while changes await review: ${refused.text}`);
      // The user accepts everything in the editor.
      await click(button(m("review_accept_all")), 15000);
      await waitFor(async () => !(await mcp.call("git_commit", { message: "AI commit" })).isError, 20000, "commit after review");
      assert(git(ROOT, "log", "-1", "--format=%s") === "AI commit", "commit made");
      await mcp.ok("git_sync");
      assert(gitBare("paper.git", "log", "-1", "--format=%s", "main") === "AI commit", "pushed by git_sync");
      return refused.text.slice(0, 120);
    } finally {
      mcp.close();
    }
  });

  await test("MCP: the app refuses a caller without its token", async () => {
    // The discovery file names the port; a wrong token must be refused by the app.
    const discovery = readJson(path.join(HOME, ".config/com.aaron.gilgamesh/mcp.json"));
    const net = await import("node:net");
    const answer = await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: "127.0.0.1", port: discovery.port }, () =>
        socket.write(JSON.stringify({ token: "wrong", name: "get_project", arguments: {} }) + "\n"),
      );
      let data = "";
      socket.on("data", (d) => (data += d));
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
      setTimeout(() => resolve(data), 5000);
    });
    assert(/"isError":\s*true/.test(answer) || answer === "", `wrong token answered: ${answer}`);
    return `answer to a wrong token: ${answer.trim().slice(0, 80) || "(connection closed)"}`;
  });

  await test("Claude Desktop extension: its server works against the app, is found and kept up to date", async () => {
    assert(BUNDLE && fs.existsSync(BUNDLE), "extension written by run.sh");
    // Installed where Claude Desktop may keep it after moving its data: Gilgamesh learns the place from the calls.
    const folder = path.join(HOME, ".local/share/Elsewhere/Claude Extensions/local.mcpb.gilgamesh");
    fs.mkdirSync(folder, { recursive: true });
    sh("python3", ["-c", "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", BUNDLE, folder]);
    const server = path.join(folder, "server", "index.js");
    const manifest = readJson(path.join(folder, "manifest.json"));
    // From now on only the extension connects Claude Desktop.
    const configFile = path.join(HOME, ".config/Claude/claude_desktop_config.json");
    const config = readJson(configFile);
    delete config.mcpServers.gilgamesh;
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));

    const mcp = new Mcp("node", [server]);
    let tools;
    try {
      const init = await mcp.request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "e2e", version: "1" },
      });
      assert(init.serverInfo?.name === "gilgamesh" && init.instructions, `initialize: ${JSON.stringify(init).slice(0, 200)}`);
      tools = (await mcp.request("tools/list")).tools;
      assert(tools.length === manifest.tools.length, `tools: app ${tools.length}, manifest ${manifest.tools.length}`);
      const project = await mcp.ok("get_project");
      assert(project.includes("main.tex"), `get_project: ${project.slice(0, 200)}`);
      const text = await mcp.ok("read_file", { path: "main.tex" });
      assert(text.includes("Inserted by the assistant"), "read_file sees the earlier edit");
    } finally {
      mcp.close();
    }
    const remembered = readJson(path.join(HOME, ".config/com.aaron.gilgamesh/extensions.json"));
    assert(remembered.includes(folder), `remembered: ${JSON.stringify(remembered)}`);

    const card = `//div[contains(@class,'card')][.//h2[normalize-space(.)='Claude Desktop']]`;
    const showAssistants = async () => {
      await openFile(m("ribbon_open"));
      await openFile(m("ribbon_assistant"));
    };
    await showAssistants();
    await find(`${card}//*[contains(@class,'connected')]`, 10000);
    // Written by an older Gilgamesh: it asks to be connected again.
    const script = fs.readFileSync(server, "utf8");
    fs.writeFileSync(server, script.replace(/^const REVISION = .*$/m, 'const REVISION = "0000000000000000";'));
    await showAssistants();
    await find(`${card}//*[contains(@class,'outdated')]`, 10000);
    fs.writeFileSync(server, script);

    // Without the app: a clear answer, and the built-in tool list.
    const empty = path.join(T, "no-app-config");
    fs.mkdirSync(empty, { recursive: true });
    const offline = new Mcp("node", [server], { ...process.env, XDG_CONFIG_HOME: empty });
    try {
      await offline.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
      const builtIn = (await offline.request("tools/list")).tools;
      assert(builtIn.length === tools.length, `built-in tools: ${builtIn.length}`);
      const answer = await offline.call("get_project");
      assert(answer.isError && /not running/.test(answer.text), `without the app: ${answer.text}`);
      await leaveFile();
      return `${tools.length} tools; found at ${path.relative(HOME, folder)}; outdated shown; offline: “${answer.text}”`;
    } finally {
      offline.close();
    }
  });

  // ---------------------------------------------------------- clone
  await test("Clone a repository from the server and open it", async () => {
    await openFile(m("ribbon_open"));
    await click(`//button[contains(@class,'tile')][.//strong[normalize-space(.)=${lit(m("git_clone"))}]]`);
    await type(`//dialog[@open]//input[@placeholder=${lit(m("git_url_placeholder"))}]`, "git://127.0.0.1/sample.git");
    await click(`//dialog[@open]//button[@type='submit']`);
    const target = path.join(T, "projects", "sample");
    await waitFor(() => fs.existsSync(path.join(target, "main.tex")), 60000, "cloned folder");
    await waitFor(async () => (await editorText()).includes("Sample project from the server."), 30000, "cloned main.tex in the editor");
    await waitCompiled(120000);
    return git(target, "log", "--format=%an: %s");
  });
}

main()
  .catch((e) => {
    console.error("fatal:", e);
    results.push({ name: "harness", ok: false, note: e.message });
  })
  .finally(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    fs.writeFileSync(path.join(T, "results.json"), JSON.stringify(results, null, 2));
    process.exit(failed.length ? 1 : 0);
  });
