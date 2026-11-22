// The document's structure: headings, numbering, footnotes, lists of items, the title, links.
import { describe, expect, it } from "vitest";
import { applyEdits, applyFormat } from "../../../tests/edits";
import { bulletActive, bulletBlock, itemsOf, listsAt, switchesList, switchList } from "./bullets";
import {
  depthEdit,
  depthOf,
  footnoteEdit,
  headingEdit,
  headingLevel,
  headingNumberedAt,
  headingStyleAt,
  numberHeading,
  secnumdepthEdit,
  unnumberHeading,
} from "./headings";
import { headingLabelEdit, isUrl, referenceCode, webLinkCode } from "./links";
import { hasSubtitle, plainText, setsTitle, titleDataOf, titleEdits, titlePageEdits, titlePageOf } from "./title";

describe("headings", () => {
  it("knows the style of the line, by the class's levels", () => {
    expect(headingStyleAt("\\section{Intro", false)).toBe(1);
    expect(headingStyleAt("\\section{Intro", true)).toBe(2);
    expect(headingStyleAt("\\chapter*{Intro", true)).toBe(1);
    expect(headingStyleAt("plain text", false)).toBe("normal");
    expect(headingStyleAt("\\paragraph{Deep", false)).toBeNull();
  });

  it("makes a paragraph a heading, changes its level and makes it text again", () => {
    const text = "  Some\n  title";
    const heading = applyFormat(text, headingEdit(text, 3, 3, 1, false)!);
    expect(heading).toEqual({ text: "  \\section{Some title}", selected: "Some title" });
    const deeper = applyFormat(heading.text, headingEdit(heading.text, 5, 5, 2, false)!);
    expect(deeper).toEqual({ text: "  \\subsection{Some title}", selected: "Some title" });
    const starred = "\\section*{Star}";
    expect(applyFormat(starred, headingEdit(starred, 3, 3, 2, false)!).text).toBe("\\subsection*{Star}");
    expect(applyFormat(deeper.text, headingEdit(deeper.text, 5, 5, "normal", false)!).text).toBe("  Some title");
    expect(headingEdit(heading.text, 5, 5, 1, false)).toBeNull();
    expect(headingEdit("text", 1, 1, "normal", false)).toBeNull();
  });

  it("inserts an empty heading on an empty line", () => {
    const edit = headingEdit("", 0, 0, 1, true)!;
    expect(edit.insert).toBe("\\chapter{}");
    expect(edit.select.anchor).toBe("\\chapter{".length);
  });

  it("maps the ribbon's levels to LaTeX's", () => {
    expect(headingLevel(1, true)).toBe(0);
    expect(headingLevel(1, false)).toBe(1);
  });
});

describe("numbering", () => {
  const MAIN = "\\documentclass{article}\n\\setcounter{secnumdepth}{1} % only sections\n\\begin{document}\n";

  it("reads how deep the document numbers and lists headings", () => {
    expect(depthOf(MAIN, "secnumdepth", false)).toBe(1);
    expect(depthOf(MAIN, "tocdepth", false)).toBe(3);
    expect(depthOf("\\documentclass{report}\n\\begin{document}", "secnumdepth", true)).toBe(2);
  });

  it("changes the setting in place, keeping its comment, or adds one", () => {
    const deeper = applyEdits(MAIN, [depthEdit(MAIN, "secnumdepth", 2, false)!]);
    expect(deeper).toContain("\\setcounter{secnumdepth}{2} % only sections");
    expect(depthEdit(deeper, "secnumdepth", 2, false)).toBeNull();
    const toc = applyEdits(MAIN, [depthEdit(MAIN, "tocdepth", 1, false)!]);
    expect(toc).toContain("\\setcounter{tocdepth}{1}\n\\begin{document}");
    expect(secnumdepthEdit(MAIN, 1, false)).toBeNull();
    expect(secnumdepthEdit(MAIN, 3, false)).not.toBeNull();
  });

  it("knows whether the heading at the cursor gets a number", () => {
    expect(headingNumberedAt("\\section{A", 1, false)).toBe(true);
    expect(headingNumberedAt("\\section*{A", 1, false)).toBe(false);
    expect(headingNumberedAt("\\subsection{A", 1, false)).toBe(false);
    expect(headingNumberedAt("text", 3, false)).toBe(false);
  });

  it("stars and unstars headings", () => {
    const text = "\\section{Intro}";
    const starred = applyFormat(text, unnumberHeading(text, 3)!).text;
    expect(starred).toBe("\\section*{Intro}");
    expect(unnumberHeading(starred, 3)).toBeNull();
    const numbered = numberHeading(starred, 3, false)!;
    expect(numbered.level).toBe(1);
    expect(applyFormat(starred, numbered.edit!).text).toBe(text);
    const koma = "\\addchap{Preface}";
    expect(applyFormat(koma, numberHeading(koma, 3, true)!.edit!).text).toBe("\\chapter{Preface}");
    expect(numberHeading("text", 1, false)).toBeNull();
  });
});

describe("footnotes", () => {
  it("go right after the word, the cursor inside", () => {
    const text = "word  next";
    const edit = footnoteEdit(text, 5, 5);
    const result = applyFormat(text, edit);
    expect(result.text).toBe("word\\footnote{} next");
    expect(result.text[edit.from + edit.select.anchor]).toBe("}");
    expect(applyFormat("ab", footnoteEdit("ab", 0, 2)).text).toBe("ab\\footnote{}");
  });
});

describe("lists of items", () => {
  it("knows the lists around the cursor", () => {
    const before = "\\begin{itemize}\n\\item a\n\\begin{enumerate}\n\\item b";
    expect(listsAt(before)).toEqual(["itemize", "enumerate"]);
    // A list inside another has levels.
    expect(bulletActive("multilevel", listsAt(before))).toBe(true);
    expect(bulletActive("enumerate", listsAt(before))).toBe(false);
    expect(bulletActive("itemize", ["itemize"])).toBe(true);
    expect(bulletActive("enumerate", ["itemize"])).toBe(false);
    expect(listsAt("% \\begin{itemize}\n")).toEqual([]);
  });

  it("switches a list to the other kind", () => {
    const text = "\\begin{itemize}\n  \\item a\n\\end{itemize}";
    const at = text.indexOf("a\n");
    expect(switchesList(text, at, "enumerate")).toBe(true);
    expect(switchesList("plain", 2, "enumerate")).toBe(false);
    expect(applyFormat(text, switchList(text, at, at, "enumerate")!).text).toBe("\\begin{enumerate}\n  \\item a\n\\end{enumerate}");
    expect(switchList(text, at, at, "itemize")).toBeNull();
  });

  it("makes an item of each paragraph of a selection", () => {
    expect(itemsOf("one\n\ntwo\nmore")).toEqual(["one", "two\nmore"]);
    expect(itemsOf("  \n")).toEqual([]);
  });

  it("writes new lists, the cursor in the first empty item", () => {
    const empty = bulletBlock("itemize", [], "");
    expect(empty.code).toBe("\\begin{itemize}\n  \\item \n\\end{itemize}");
    expect(empty.code.slice(0, empty.select.anchor).endsWith("\\item ")).toBe(true);
    const levels = bulletBlock("multilevel", [], "  ");
    expect(levels.code).toBe(
      "\\begin{enumerate}\n    \\item \n    \\begin{enumerate}\n      \\item \n    \\end{enumerate}\n  \\end{enumerate}",
    );
    const made = bulletBlock("enumerate", ["one", "two"], "");
    expect(made.code).toBe("\\begin{enumerate}\n  \\item one\n  \\item two\n\\end{enumerate}");
    expect(made.select.anchor).toBe(made.code.length);
  });
});

describe("the title", () => {
  const MAIN = String.raw`\documentclass{scrreprt}
\usepackage{graphicx}
\title{On \emph{new} ideas}
\author{Ada \and Grace}
\date{\today}
\begin{document}
\end{document}`;

  it("reads title, authors and date", () => {
    expect(titleDataOf(MAIN)).toEqual({ title: "On \\emph{new} ideas", subtitle: "", authors: ["Ada", "Grace"], date: null });
    expect(hasSubtitle(MAIN)).toBe(true);
    expect(plainText("On \\emph{new}\\\\ ideas~here")).toBe("On new ideas here");
  });

  it("writes them, adds \\maketitle and drops an empty subtitle", () => {
    const data = { title: "Thesis", subtitle: "", authors: ["Ada"], date: "2026" };
    const written = applyEdits(MAIN, titleEdits(MAIN, data, true));
    expect(written).toContain("\\title{Thesis}");
    expect(written).toContain("\\author{Ada}");
    expect(written).toContain("\\date{2026}");
    expect(written).toContain("\\begin{document}\n\\maketitle");
    expect(setsTitle(written)).toBe(true);
    expect(setsTitle(MAIN)).toBe(false);
    expect(titleDataOf(written)).toEqual(data);
  });

  it("puts the title on a page of its own by the class option or the class's habit", () => {
    expect(titlePageOf(MAIN)).toBe(true);
    expect(titlePageOf("\\documentclass{article}")).toBe(false);
    const own = applyEdits("\\documentclass{article}", titlePageEdits("\\documentclass{article}", true));
    expect(titlePageOf(own)).toBe(true);
    expect(titlePageEdits(MAIN, true)).toEqual([]);
  });
});

describe("links", () => {
  it("references a label as the style asks", () => {
    const plain = "\\documentclass{article}\n\\usepackage{hyperref}\n\\begin{document}";
    expect(referenceCode("sec:a", "named", "", plain)).toBe("\\autoref{sec:a}");
    expect(referenceCode("sec:a", "named", "", "\\usepackage{cleveref}\n\\begin{document}")).toBe("\\cref{sec:a}");
    expect(referenceCode("sec:a", "number", "", plain)).toBe("\\ref{sec:a}");
    expect(referenceCode("sec:a", "page", "", plain)).toBe("\\pageref{sec:a}");
    expect(referenceCode("sec:a", "text", "see here", plain)).toBe("\\hyperref[sec:a]{see here}");
  });

  it("labels a heading right after its title", () => {
    const text = "Intro\n\\section{Methods} % note\n";
    const edit = headingLabelEdit(text, 2, "sec:methods")!;
    expect(text.slice(0, edit.at) + edit.insert + text.slice(edit.at)).toBe("Intro\n\\section{Methods}\\label{sec:methods} % note\n");
    expect(headingLabelEdit(text, 1, "x")).toBeNull();
  });

  it("writes web links, escaping what other arguments would break", () => {
    expect(isUrl("example.org/a")).toBe(true);
    expect(isUrl("has space")).toBe(false);
    expect(isUrl("a}b")).toBe(false);
    expect(webLinkCode("example.org", "")).toBe("\\url{https://example.org}");
    expect(webLinkCode("https://x.org/a#b%c", "site")).toBe("\\href{https://x.org/a\\#b\\%c}{site}");
    expect(webLinkCode("me@example.org", "")).toBe("\\href{mailto:me@example.org}{\\nolinkurl{me@example.org}}");
  });
});
