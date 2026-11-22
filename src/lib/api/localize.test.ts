import { describe, expect, it } from "vitest";
import { m } from "$lib/paraglide/messages";
import { localize, translate } from "./localize";

// The backend's encoding (see src-tauri/src/util/i18n.rs).
const encode = (message: string, params: Record<string, string> = {}) => JSON.stringify({ message, params });

describe("localize", () => {
  it("translates the backend's messages", () => {
    expect(localize(encode("error_program_missing", { program: "Git" }))).toBe(m.error_program_missing({ program: "Git" }));
  });

  it("translates messages inside parameters", () => {
    const inner = encode("error_program_missing", { program: "latexmk" });
    expect(localize(encode("log_essentials_incomplete", { error: inner }))).toBe(
      m.log_essentials_incomplete({ error: m.error_program_missing({ program: "latexmk" }) }),
    );
  });

  it("leaves other text as it is", () => {
    expect(localize("! Undefined control sequence.")).toBe("! Undefined control sequence.");
    expect(localize('{"message": broken')).toBe('{"message": broken');
  });

  it("shows the key of a message it does not know", () => {
    expect(localize(encode("no_such_message"))).toBe("no_such_message");
    expect(translate("no_such_message")).toBeNull();
  });
});
