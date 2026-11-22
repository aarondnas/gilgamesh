// The editor's extensions that work on the document's state: AI review and completions.
import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  acceptAll,
  aiReview,
  originalText,
  rejectAll,
  restoreReview,
  reviewOf,
  reviewSections,
  reviewState,
  sectionsBetween,
} from "./ai-review";
import { latexCompletions, type CompletionData } from "./completions";

describe("AI review", () => {
  const labels = { accept: "Accept", reject: "Reject", acceptTitle: "", rejectTitle: "" };
  const fromAssistant = (tr: Transaction) => tr.isUserEvent("assistant");
  const ORIGINAL = "one\ntwo\nthree\nfour";

  function edited() {
    const state = EditorState.create({ doc: ORIGINAL, extensions: [reviewState, aiReview({ fromAssistant, labels })] });
    return state.update({ changes: { from: 4, to: 7, insert: "TWO" }, userEvent: "assistant" }).state;
  }

  it("keeps the original of an assistant's edit and marks the section", () => {
    const state = edited();
    expect(state.doc.toString()).toBe("one\nTWO\nthree\nfour");
    expect(reviewOf(state)).not.toBeNull();
    expect(originalText(state)).toBe(ORIGINAL);
    expect(reviewSections(state)).toEqual([{ line: 2, endLine: 2 }]);
  });

  it("puts the user's own edits outside the sections into the original", () => {
    const state = edited();
    const typed = state.update({ changes: { from: state.doc.length, insert: "!" }, userEvent: "input.type" }).state;
    expect(originalText(typed)).toBe(`${ORIGINAL}!`);
    expect(reviewSections(typed)).toEqual([{ line: 2, endLine: 2 }]);
  });

  it("accepts all: the text stays and becomes the original", () => {
    const accepted = acceptAll(edited(), false).state;
    expect(accepted.doc.toString()).toBe("one\nTWO\nthree\nfour");
    expect(reviewOf(accepted)).toBeNull();
  });

  it("rejects all: the original comes back", () => {
    const rejected = rejectAll(edited())!.state;
    expect(rejected.doc.toString()).toBe(ORIGINAL);
    expect(reviewOf(rejected)).toBeNull();
    const plain = EditorState.create({ doc: ORIGINAL, extensions: [reviewState, aiReview({ fromAssistant, labels })] });
    expect(rejectAll(plain)).toBeNull();
  });

  it("restores a review kept from an earlier session", () => {
    const state = EditorState.create({ doc: "changed", extensions: [reviewState, aiReview({ fromAssistant, labels })] });
    const restored = restoreReview(state, "original").state;
    expect(originalText(restored)).toBe("original");
  });

  it("finds the sections of files not open in an editor, close changes in one", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const changed = lines.map((line, i) => (i === 1 || i === 25 ? line.toUpperCase() : line));
    expect(sectionsBetween(lines.join("\n"), changed.join("\n"))).toEqual([
      { line: 2, endLine: 2 },
      { line: 26, endLine: 26 },
    ]);
    expect(sectionsBetween("a\nb\nc", "a\nB\nc\nd")).toEqual([{ line: 2, endLine: 4 }]);
    expect(sectionsBetween("same", "same")).toEqual([]);
  });
});

describe("completions", () => {
  const data: CompletionData = {
    labels: [{ key: "fig:logo", file: "main.tex" }],
    citations: [{ key: "knuth1984", title: "The TeXbook", author: "Knuth" }],
    packages: [],
  };
  const complete = (text: string, explicit = false) => {
    const state = EditorState.create({ doc: text });
    return latexCompletions(() => data)(new CompletionContext(state, text.length, explicit)) as CompletionResult | null;
  };
  const labelsOf = (result: CompletionResult | null) => result?.options.map((o) => o.label) ?? [];

  it("offers labels in references and keys in citations", () => {
    expect(labelsOf(complete("see \\ref{fig"))).toEqual(["fig:logo"]);
    expect(labelsOf(complete("\\parencite[p.~3]{a,"))).toEqual(["knuth1984"]);
  });

  it("offers environments and packages", () => {
    expect(labelsOf(complete("\\begin{fig"))).toContain("figure");
    expect(labelsOf(complete("\\usepackage[utf8]{"))).toContain("graphicx");
  });

  it("offers commands after a backslash", () => {
    const result = complete("text \\sec");
    expect(result?.from).toBe(5);
    expect(labelsOf(result)).toContain("\\section{…}");
    expect(complete("plain text")).toBeNull();
  });
});
