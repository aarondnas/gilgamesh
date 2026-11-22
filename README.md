# Gilgamesh

A LaTeX editor with a live PDF preview, built with Tauri 2, Svelte 5 and TypeScript.

## Prerequisites

- [Node.js](https://nodejs.org) ≥ 20
- [Rust](https://rustup.rs)
- Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (workload "Desktop development with C++")
- Other systems: see the [Tauri prerequisites](https://tauri.app/start/prerequisites/)

## Build

```sh
npm install
npm run tauri dev     # development
npm run tauri build   # release → src-tauri/target/release/bundle/
```

## Structure

Frontend and backend are organized by the same domains: `tex`, `project`,
`git`, `spell`, `settings`, `mcp` (AI assistants), `print` and `window`.

```
src-tauri/src/
  commands/<domain>.rs     Tauri commands: they only take the request and pass it on
  <domain>.rs, <domain>/   the logic itself (project/, tex/, mcp/, window/, …)
  util/                    shared helpers (atomic writes, processes without a console,
                           messages in the user's language)
src/lib/
  api/<domain>.ts          typed calls of the commands, split like commands/
  latex/                   reading and changing LaTeX source (pure functions; syntax.ts
                           holds what they share)
  editor/                  the CodeMirror editor and its extensions
  components/<area>/       editor, dialogs, pdf, project, git, settings, window,
                           ribbon (tabs/ = one component per ribbon tab); ui = building blocks
  state/                   stores (Svelte runes): document (tabs, dialogs, files), build,
                           formatting, page-layout, inserting, project, search, …
  pdf/                     rendering the PDF, laying pages out on sheets for print
  config/                  static data: templates, project file types and names, spelling
  util/                    small helpers: paths, dropped files, motion, regular expressions,
                           Git URLs, the project search, font previews
messages/                  UI texts in all languages (Paraglide)
scripts/                   generators (third-party notices, symbol table, app icon), test runner
tests/                     setup and helpers of the frontend's tests
```

Messages the backend shows to the user are sent as the key of a message in
`messages/` and translated by the page (see `src-tauri/src/util/i18n.rs`).

## Tests

```sh
npm test                       # the frontend's logic (Vitest, *.test.ts beside the code)
npm run check                  # types (svelte-check)
cd src-tauri && cargo test     # the backend
```

`npm test` uses `vitest.config.ts`, not the app's Vite configuration, so it can
run beside `npm run tauri dev`.

## Formatting

```sh
npm run format                 # Prettier: TypeScript, Svelte, CSS, JSON
cd src-tauri && cargo fmt      # rustfmt (rustfmt.toml)
```

## License

Gilgamesh is free software under the [GNU General Public License, version 3 or later](LICENSE)
(GPL-3.0-or-later). You may use, change and share the code. Whoever builds it into an app of
their own and distributes that app must publish it under the GPL as well, with its source code.

The names and logos of Gilgamesh and PigeonBits are not covered by the license, see [NOTICE](NOTICE).
Components by other authors are under their own licenses, see
[static/third-party-notices.txt](static/third-party-notices.txt).
