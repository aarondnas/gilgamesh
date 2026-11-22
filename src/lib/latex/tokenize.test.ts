import { describe, expect, it } from "vitest";
import { tokenize } from "./tokenize";

const words = (text: string) => tokenize(text).map((t) => t.word);

describe("tokenize", () => {
  it("finds the prose words with their offsets", () => {
    const text = "Hello world, again.";
    const tokens = tokenize(text);
    expect(tokens.map((t) => t.word)).toEqual(["Hello", "world", "again"]);
    expect(tokens.every((t) => text.slice(t.from, t.to) === t.word)).toBe(true);
  });

  it("checks the arguments of text commands, but not of others", () => {
    expect(words(String.raw`\section{Intro text} \emph{bold words} \usepackage{graphicx} \label{sec:intro}`)).toEqual([
      "Intro",
      "text",
      "bold",
      "words",
    ]);
  });

  it("skips the keys before prose arguments", () => {
    expect(words(String.raw`\href{https://example.org}{the site} \textcolor{red}{warm}`)).toEqual(["the", "site", "warm"]);
  });

  it("leaves out math, comments, verbatim and code environments", () => {
    const text = String.raw`One $x + y$ two \[ z \] three % comment
\verb|code| four
\begin{verbatim}
inside
\end{verbatim}
five`;
    expect(words(text)).toEqual(["One", "two", "three", "four", "five"]);
  });

  it("leaves out single letters, acronyms, camelCase and identifiers", () => {
    expect(words("a GMP iPhone camelCase word2 my_var real")).toEqual(["real"]);
  });

  it("keeps apostrophes inside a word, not at its end", () => {
    expect(words("don't the students' work")).toEqual(["don't", "the", "students", "work"]);
  });

  it("reads letters of any script", () => {
    expect(words("Größe Привет")).toEqual(["Größe", "Привет"]);
  });
});
