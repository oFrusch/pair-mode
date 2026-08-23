import { test, expect, describe } from "vitest";
import { supportsTruecolor, fg, bg, theme } from "../src/tui/paint";

describe("supportsTruecolor", () => {
  test("returns true for COLORTERM=truecolor", () => {
    expect(supportsTruecolor({ COLORTERM: "truecolor" })).toBe(true);
  });

  test("returns true for COLORTERM=24bit", () => {
    expect(supportsTruecolor({ COLORTERM: "24bit" })).toBe(true);
  });

  test("returns false for an empty environment", () => {
    expect(supportsTruecolor({})).toBe(false);
  });

  test("returns false for COLORTERM=8bit", () => {
    expect(supportsTruecolor({ COLORTERM: "8bit" })).toBe(false);
  });
});

describe("fg and bg with truecolor", () => {
  test("fg returns the exact 24-bit escape for addBar", () => {
    expect(fg(theme.addBar, true)).toBe("\x1b[38;2;63;185;80m");
  });

  test("fg returns the exact 24-bit escape for delBar", () => {
    expect(fg(theme.delBar, true)).toBe("\x1b[38;2;248;81;73m");
  });

  test("bg returns the exact 24-bit escape for addSpan", () => {
    expect(bg(theme.addSpan, true)).toBe("\x1b[48;2;31;91;46m");
  });
});

describe("fg without truecolor", () => {
  test("maps every palette entry to its ANSI 16 foreground code", () => {
    expect(fg(theme.addBar, false)).toBe("\x1b[32m");
    expect(fg(theme.addSpan, false)).toBe("\x1b[32m");
    expect(fg(theme.delBar, false)).toBe("\x1b[31m");
    expect(fg(theme.delSpan, false)).toBe("\x1b[31m");
    expect(fg(theme.selection, false)).toBe("\x1b[34m");
    expect(fg(theme.note, false)).toBe("\x1b[35m");
    expect(fg(theme.fold, false)).toBe("\x1b[90m");
    expect(fg(theme.chrome, false)).toBe("\x1b[33m");
  });
});

describe("a valid, unlisted hex", () => {
  test("fg converts it normally under truecolor, since truecolor never needs the ANSI-16 lookup", () => {
    expect(fg("#123456", true)).toBe("\x1b[38;2;18;52;86m");
  });

  test("fg falls back to the default code without truecolor, since the ANSI-16 table has no entry for it", () => {
    expect(fg("#123456", false)).toBe("\x1b[39m");
  });

  test("bg falls back to the default code without truecolor, since the ANSI-16 table has no entry for it", () => {
    expect(bg("#123456", false)).toBe("\x1b[49m");
  });
});

describe("a malformed hex", () => {
  test("fg falls back to the default code under truecolor", () => {
    expect(fg("not-a-color", true)).toBe("\x1b[39m");
    expect(fg("#12345", true)).toBe("\x1b[39m");
  });

  test("bg falls back to the default code under truecolor", () => {
    expect(bg("not-a-color", true)).toBe("\x1b[49m");
    expect(bg("#12345", true)).toBe("\x1b[49m");
  });

  test("fg falls back to the default code without truecolor", () => {
    expect(fg("not-a-color", false)).toBe("\x1b[39m");
    expect(fg("#12345", false)).toBe("\x1b[39m");
  });

  test("bg falls back to the default code without truecolor", () => {
    expect(bg("not-a-color", false)).toBe("\x1b[49m");
    expect(bg("#12345", false)).toBe("\x1b[49m");
  });
});
