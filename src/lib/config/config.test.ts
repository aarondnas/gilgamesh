// The static data: file types, spelling languages and the templates of new projects.
import { describe, expect, it } from "vitest";
import { maskComments } from "$lib/latex/syntax";
import {
  EDITABLE_EXTENSIONS,
  extensionOf,
  fileKind,
  opensInTab,
  PROJECT_FILES,
  syntaxOf,
  validateName,
  validateRename,
  VISIBLE_EXTENSIONS,
} from "./project-files";
import { isSpellSetting, spellLanguageForLocale, spellLanguageName } from "./spelling";
import { ARTICLE, LETTER, PRESENTATION, THESIS, type Lang } from "./template-texts";
import { template, TEMPLATE_IDS } from "./templates";

const LANGS: Lang[] = ["de", "en", "fr", "es", "it", "pt", "nl", "pl", "ru", "zh", "ja"];

describe("project files", () => {
  it("are sorted into kinds by extension, case aside", () => {
    expect(extensionOf("chapters/Intro.TEX")).toBe("tex");
    expect(extensionOf("Makefile")).toBe("");
    expect(fileKind("main.tex")).toBe("editable");
    expect(fileKind("images/logo.PNG")).toBe("viewable");
    expect(fileKind("gilgamesh.json")).toBeNull();
    expect(opensInTab("refs.bib")).toBe(true);
    expect(opensInTab("notes.json")).toBe(false);
    expect(VISIBLE_EXTENSIONS).toContain(".tex");
  });

  it("know their syntax", () => {
    expect(syntaxOf("main.tex")).toBe("latex");
    expect(syntaxOf("filter.lua")).toBe("lua");
    expect(syntaxOf("data.csv")).toBe("plain");
  });

  it("get .tex where they have no extension, and only types the explorer shows", () => {
    expect(validateName(" chapter ", "file")).toBe("chapter.tex");
    expect(validateName("refs.bib", "file")).toBe("refs.bib");
    expect(validateName("images", "folder")).toBe("images");
    for (const name of ["a/b", "a\\b", "a:b", "..", ".", " "]) expect(() => validateName(name, "folder"), name).toThrow();
    expect(() => validateName("photo.png", "file")).toThrow();
    expect(EDITABLE_EXTENSIONS).toContain(".tex");
  });

  it("keep their extension when renamed without one", () => {
    expect(validateRename("images/logo.png", "brand", false)).toBe("brand.png");
    expect(validateRename("main.tex", "thesis.tex", false)).toBe("thesis.tex");
    expect(validateRename("chapters", "parts", true)).toBe("parts");
    expect(() => validateRename("main.tex", "main.json", false)).toThrow();
  });

  it("belong to one kind each", () => {
    const all = Object.values(PROJECT_FILES).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("spelling", () => {
  it("follows the interface language, English where there is no dictionary", () => {
    expect(spellLanguageForLocale("de")).toBe("de");
    expect(spellLanguageForLocale("pt")).toBe("pt-PT");
    expect(spellLanguageForLocale("ru")).toBe("en");
    expect(isSpellSetting("auto")).toBe(true);
    expect(isSpellSetting("de-AT")).toBe(true);
    expect(isSpellSetting("xx")).toBe(false);
    expect(spellLanguageName("de-AT", "en")).toMatch(/German/);
    expect(spellLanguageName("de", "de")).toBe("Deutsch");
  });
});

describe("templates", () => {
  it("have their texts in every language", () => {
    for (const texts of [ARTICLE, LETTER, PRESENTATION, THESIS]) expect(Object.keys(texts).sort()).toEqual([...LANGS].sort());
  });

  it("make a complete document in every language", () => {
    for (const id of TEMPLATE_IDS) {
      for (const lang of LANGS) {
        const made = template(id, lang);
        const main = made.files[made.main];
        expect(main, `${id} ${lang}`).toBeDefined();
        const code = maskComments(main);
        expect(code, `${id} ${lang}`).toMatch(/\\documentclass/);
        expect(code, `${id} ${lang}`).toMatch(/\\begin\{document\}[\s\S]*\\end\{document\}/);
        // Braces balance in every file (`\\` is a line break, `\{` a brace of the text).
        for (const [path, text] of Object.entries(made.files).filter(([path]) => path.endsWith(".tex"))) {
          const masked = maskComments(text)
            .replace(/\\\\/g, "")
            .replace(/\\[{}]/g, "");
          expect(masked.split("{").length, `${id} ${lang} ${path}`).toBe(masked.split("}").length);
        }
        // Every file read in is there.
        for (const [, input] of code.matchAll(/\\(?:input|include)\{([^}]+)\}/g)) {
          expect(made.files[`${input}.tex`] ?? made.files[input], `${id} ${lang} ${input}`).toBeDefined();
        }
        for (const [, bib] of code.matchAll(/\\addbibresource\{([^}]+)\}/g)) expect(made.files[bib], `${id} ${lang} ${bib}`).toBeDefined();
      }
    }
  });

  it("fall back to English for another interface language", () => {
    expect(template("article", "sv").files).toEqual(template("article", "en").files);
  });
});
