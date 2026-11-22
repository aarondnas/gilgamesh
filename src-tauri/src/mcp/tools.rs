//! The tools Gilgamesh offers. The page implements them (`src/lib/mcp/assistant.svelte.ts`);
//! names and parameters must match there.

use serde_json::{json, Value};

/// Shown to the assistant once per session, before any tool is used.
pub const INSTRUCTIONS: &str = "Gilgamesh is a LaTeX editor with live PDF preview. These tools are the way to \
work with it: they reach the running app directly, also when its window is minimized or behind others. \
Do not look for Gilgamesh's window with screen control, computer use or a browser, and do not ask the user \
to open it while the tools answer. They act on the \
project open in the app, as the user would: edits go through the editor, so the user sees them \
and can undo them with Ctrl+Z, and so can you with undo. Your edits take effect at once (the file and the PDF show them) \
but stay marked for the user to accept or reject, section by section; only accepted text becomes a version in the history. \
Files you create or delete await review too: rejecting a new file deletes it, rejecting a deletion brings the file back. \
Changes made to the files outside Gilgamesh (e.g. with your own file tools) are detected and await review as well, \
so prefer these tools: they show the change in the editor right away. get_review lists what awaits review; \
accepting or rejecting is the user's decision. \
Paths are relative to the project folder and use forward slashes. \
Start with get_project. Prefer edit_file (exact text replacement) over write_file for existing files. \
After changing the document, call compile and check the reported problems. \
If the project is a Git repository, git_status shows its state; commit with git_commit only when the user asks \
and nothing awaits review, and sync with the server (git_sync) only when the user asks for it. \
Change Gilgamesh's settings (language, compiling, zoom) and the project's configuration (main file, engine, \
PDF standard, spell checking) only with get_settings and update_settings: never edit Gilgamesh's own files \
such as settings.json or gilgamesh.json directly, because the running app would not take the change over \
and would overwrite it.";

/// Starts every tool description. Some assistants (e.g. Codex) do not show MCP tools to the model
/// up front but let it search for them; a search for "Gilgamesh" or "LaTeX" then finds them.
const DESCRIPTION_PREFIX: &str = "Gilgamesh (LaTeX editor app): ";

pub fn list() -> Value {
    let mut tools = definitions();
    for tool in tools.as_array_mut().into_iter().flatten() {
        if let Some(Value::String(description)) = tool.get_mut("description") {
            description.insert_str(0, DESCRIPTION_PREFIX);
        }
    }
    tools
}

fn definitions() -> Value {
    let path = json!({ "type": "string", "description": "Path relative to the project folder, e.g. \"chapters/intro.tex\"." });
    json!([
        {
            "name": "get_project",
            "description": "Project folder, main file, engine, PDF standard, the file open in the editor, and all files of the project.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "read_file",
            "description": "Text of a project text file (.tex, .bib, .sty, .cls, .tikz, .bst, .csv, .lua, …). For the file open in the editor this includes unsaved changes. Lines are numbered.",
            "inputSchema": {
                "type": "object",
                "properties": { "path": path },
                "required": ["path"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "search",
            "description": "Finds text in all editable project files. Returns path:line: text for each match (at most 200).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Text to find, or a JavaScript regular expression if regex is true." },
                    "regex": { "type": "boolean", "description": "Treat query as a regular expression. Default false." },
                    "caseSensitive": { "type": "boolean", "description": "Default false." }
                },
                "required": ["query"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "get_outline",
            "description": "Headings (with their number as LaTeX sets it, file and line), labels and bibliography entries of the document, as Gilgamesh scanned them.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "get_problems",
            "description": "Result of the last build: errors and warnings with file and line, missing packages and missing project files.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "compile",
            "description": "Compiles the document (saving first) and returns the problems of this build. Missing packages may be installed automatically if the user enabled that.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "edit_file",
            "description": "Replaces old_text with new_text in a file, as one undoable edit in the editor. old_text must occur exactly once (include surrounding lines to make it unique). The file is opened in the editor.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": path,
                    "old_text": { "type": "string", "description": "Exact text to replace, including whitespace and line breaks." },
                    "new_text": { "type": "string", "description": "Replacement text." }
                },
                "required": ["path", "old_text", "new_text"],
                "additionalProperties": false
            },
            "annotations": { "destructiveHint": false }
        },
        {
            "name": "write_file",
            "description": "Creates a text file (.tex, .bib, .sty, .cls, .tikz, .bst, .csv, .lua, …; folders are created as needed) or replaces the whole content of an existing one, as one undoable edit in the editor.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": path,
                    "content": { "type": "string", "description": "Complete new file content." }
                },
                "required": ["path", "content"],
                "additionalProperties": false
            }
        },
        {
            "name": "delete_file",
            "description": "Deletes a text file of the project (.tex, .bib, .sty, .cls, .tikz, .bst, .csv, .lua, …). It goes to the recycle bin and awaits the user's review: rejecting the deletion brings it back with its last text.",
            "inputSchema": {
                "type": "object",
                "properties": { "path": path },
                "required": ["path"],
                "additionalProperties": false
            },
            "annotations": { "destructiveHint": true }
        },
        {
            "name": "rename_file",
            "description": "Renames or moves a file or folder inside the project; the open file, the main file and changes awaiting review move along. \\input and \\include references are not rewritten: update them with edit_file. A rename is not marked for review.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": path,
                    "new_path": { "type": "string", "description": "New path relative to the project folder; it must not exist yet." }
                },
                "required": ["path", "new_path"],
                "additionalProperties": false
            }
        },
        {
            "name": "get_review",
            "description": "Changes by assistants (or made outside Gilgamesh) that await the user's review: files with changed sections (and their lines), files created and files deleted. The user accepts or rejects them in Gilgamesh.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "install_packages",
            "description": "Installs LaTeX packages from TeX Live into Gilgamesh's TeX distribution, e.g. [\"siunitx\", \"biblatex\"]. Builds also report missing packages; use this when a document needs one.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "names": { "type": "array", "items": { "type": "string" }, "minItems": 1, "description": "TeX Live package names." }
                },
                "required": ["names"],
                "additionalProperties": false
            },
            "annotations": { "openWorldHint": true }
        },
        {
            "name": "git_status",
            "description": "Git state of the project: whether it is a repository, its folder, branch, remote, commits not yet synced either way, and changed files (staged and not staged).",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "git_commit",
            "description": "Commits in the project's Git repository: the given files, or all changes if none are given. Only when the user asks for it; refused while changes await review, since the user has not accepted them yet.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "message": { "type": "string", "description": "Commit message." },
                    "paths": { "type": "array", "items": { "type": "string" }, "description": "Files to commit, relative to the repository folder as git_status lists them. Default: all changes." }
                },
                "required": ["message"],
                "additionalProperties": false
            }
        },
        {
            "name": "git_sync",
            "description": "Syncs the project's Git repository with its server: pulls the remote branch's commits and pushes the local ones; publishes a branch that has no remote branch yet. Only when the user explicitly asks for it.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": { "openWorldHint": true }
        },
        {
            "name": "get_settings",
            "description": "Gilgamesh's settings (interface language and the available ones, automatic compiling and package installation, editor zoom, unit for lengths) and the open project's configuration (main file, engine, PDF standard, spell checking).",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "update_settings",
            "description": "Changes Gilgamesh's settings (e.g. switches the interface language to English) and the open project's configuration; they take effect at once, no restart needed. Give only the fields to change. This is the only correct way to change them.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "language": { "type": "string", "description": "Interface language: a code listed by get_settings (e.g. \"de\", \"en\"), or \"system\" to follow the operating system." },
                    "autoSave": { "type": "boolean", "description": "Save edits shortly after typing; off, only explicit saves, switching files and closing write them (compiling uses the unsaved text)." },
                    "autoCompile": { "type": "boolean", "description": "Compile automatically while typing." },
                    "autoInstallPackages": { "type": "boolean", "description": "Install missing packages without asking." },
                    "editorZoom": { "type": "number", "minimum": 0.5, "maximum": 2.5, "description": "Editor text size, 1 = 100 %." },
                    "unit": { "type": "string", "enum": ["system", "cm", "mm", "in"], "description": "Unit for lengths such as page margins; \"system\" follows the measurement system of the operating system's region settings." },
                    "mainFile": { "type": "string", "description": "Project file that gets compiled, e.g. \"main.tex\"." },
                    "engine": { "type": "string", "enum": ["lualatex", "xelatex", "pdflatex"] },
                    "pdfStandard": { "type": "string", "description": "\"none\" for plain PDF, or one of A-1b, A-2b, A-2u, A-3b, A-3u, A-4, UA-2." },
                    "spellLanguage": { "type": "string", "description": "\"auto\" (from babel/polyglossia), \"off\", or a dictionary code listed by get_settings." }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "undo",
            "description": "Undoes the newest edit in the project, whoever made it (user or assistant) and in whichever file, exactly like Ctrl+Z in Gilgamesh. Call it repeatedly to go further back.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "redo",
            "description": "Redoes the newest undone edit, like Ctrl+Y in Gilgamesh.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "open_file",
            "description": "Shows a file in the editor, optionally at a line, and the matching spot in the PDF preview.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": path,
                    "line": { "type": "integer", "minimum": 1, "description": "1-based line. Default 1." }
                },
                "required": ["path"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true }
        }
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every tool announced here has its implementation in the page, and the other way round.
    #[test]
    fn every_tool_is_implemented_in_the_page() {
        let page = include_str!("../../../src/lib/mcp/assistant.svelte.ts");
        let start = page.find("const TOOLS").expect("TOOLS in assistant.svelte.ts");
        let implemented: Vec<&str> = page[start..].lines().filter_map(|line| line.strip_prefix("  async ")?.split('(').next()).collect();
        let announced: Vec<String> = list().as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_owned()).collect();
        for name in &announced {
            assert!(implemented.contains(&name.as_str()), "{name} is announced but not implemented");
        }
        for name in &implemented {
            assert!(announced.iter().any(|a| a == name), "{name} is implemented but not announced");
        }
        assert!(list()[0]["description"].as_str().unwrap().starts_with(DESCRIPTION_PREFIX));
    }
}
