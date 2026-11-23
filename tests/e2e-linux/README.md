# End-to-end tests on Linux

`run.sh` starts the debug build of Gilgamesh through WebDriver and uses it the way
a user would: it clicks, types and answers dialogs. Afterwards it checks each result
where the result ends up: files and repositories on disk, the printer's output,
the assistants' configuration files and the TeX installation.

| Area     | What is checked                                                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TeX      | Installing TinyTeX from the Packages page (`--fresh-tex`)                                                                                                                        |
| Git      | New project as a repository, published to a server; commit, sync, merge of a commit made elsewhere; cloning                                                                      |
| Packages | Install and remove from the catalog (with the real confirmation dialog); installing on demand while compiling                                                                    |
| Printing | One and two pages per sheet on the CUPS PDF printer, compared with the compiled PDF; "Add printer …"                                                                             |
| AI       | Connecting Claude Desktop, Claude Code and Codex; the MCP server (`gilgamesh --mcp`) and the Claude Desktop extension against the running app; review before commit; token check |

## Setup (Ubuntu 22.04 or later, also WSL)

```sh
scripts/linux/install-build-deps.sh
sudo apt install webkit2gtk-driver cups printer-driver-cups-pdf poppler-utils python3-gi gir1.2-atspi-2.0
cargo install tauri-driver --locked
lpadmin -d PDF                         # the cups-pdf printer as default (it writes to ~/PDF)
npm ci && npx tauri build --debug --no-bundle
```

## Running

```sh
tests/e2e-linux/run.sh                 # all tests, with a copy of the app's TinyTeX
tests/e2e-linux/run.sh --fresh-tex     # installs TinyTeX through the app first (downloads it)
tests/e2e-linux/run.sh git package    # only tests whose name contains one of the words
```

The tests build on each other: most need the project that the first one creates,
so a filter must include "New project".

The tests run in their own world in `~/gilgamesh-e2e` (`E2E_DIR`), which is rebuilt
on every run:

- a separate `HOME`, so Git starts without a name or e-mail
- a `git daemon` on `git://127.0.0.1`
- stand-ins for Claude Desktop, Claude Code (`claude`) and Codex
- stand-ins for the programs that open printer settings and URLs, which only log
  their calls (under WSL, URLs would otherwise open in the Windows browser)

Screenshots of failed tests and of the final state are saved to `shots/`, and the
results to `results.json`.

## Good to know

- Native GTK message boxes, such as the confirmation before removing a package,
  are answered through AT-SPI (`answer-dialog.py`). They can't be stubbed in the
  page: `__TAURI_INTERNALS__.invoke` cannot be changed.
- WebKitWebDriver has no "is displayed" endpoint, and its "send keys" doesn't reach
  CodeMirror. The tests check visibility with JavaScript and type with the Actions API.
- Printing is judged by the paper, not by the "Sent to …" message. `pdftoppm` renders
  the output of cups-pdf, and the tests compare where its ink sits with the compiled PDF.
