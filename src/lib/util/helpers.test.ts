// The small helpers: regular expressions, Git URLs, reduced motion.
import { describe, expect, it } from "vitest";
import { isRemoteUrl } from "./git-url";
import { motionMs, prefersReducedMotion } from "./motion";
import { escapeRegExp } from "./regex";

describe("escapeRegExp", () => {
  it("matches the text literally", () => {
    const text = "a.b*c(d)[e]{f}^$|\\+?";
    expect(new RegExp(`^${escapeRegExp(text)}$`).test(text)).toBe(true);
    expect(new RegExp(escapeRegExp("a.c")).test("abc")).toBe(false);
  });
});

describe("isRemoteUrl", () => {
  it("accepts the addresses Git clones from", () => {
    for (const url of [
      "https://github.com/me/thesis.git",
      "http://example.org/repo",
      "ssh://git@host/repo.git",
      "git://host/repo",
      "git+ssh://host/repo",
      "git@github.com:me/thesis.git",
    ]) {
      expect(isRemoteUrl(url), url).toBe(true);
    }
  });

  it("refuses folders, drives and anything with spaces", () => {
    for (const url of ["C:\\Users\\me\\repo", "/home/me/repo", "github.com/me/repo", "https://host/a b", "", "git@host"]) {
      expect(isRemoteUrl(url), url).toBe(false);
    }
  });
});

describe("motion", () => {
  it("keeps durations unless the user asked to reduce motion", () => {
    // tests/setup.ts: the system does not ask to reduce motion.
    expect(prefersReducedMotion()).toBe(false);
    expect(motionMs(220)).toBe(220);
  });
});
