import { test, expect, describe } from "vitest";
import { parseKeys } from "../src/tui/input/keys";

describe("parseKeys — the byte table", () => {
  test("\\x1b[A is up", () => {
    expect(parseKeys("\x1b[A")).toEqual([{ name: "up", ctrl: false, text: "" }]);
  });

  test("\\x1b[B is down", () => {
    expect(parseKeys("\x1b[B")).toEqual([{ name: "down", ctrl: false, text: "" }]);
  });

  test("\\x1b[C is right", () => {
    expect(parseKeys("\x1b[C")).toEqual([{ name: "right", ctrl: false, text: "" }]);
  });

  test("\\x1b[D is left", () => {
    expect(parseKeys("\x1b[D")).toEqual([{ name: "left", ctrl: false, text: "" }]);
  });

  test("\\r is enter", () => {
    expect(parseKeys("\r")).toEqual([{ name: "enter", ctrl: false, text: "" }]);
  });

  test("\\n is enter", () => {
    expect(parseKeys("\n")).toEqual([{ name: "enter", ctrl: false, text: "" }]);
  });

  test("a lone \\x1b is escape", () => {
    expect(parseKeys("\x1b")).toEqual([{ name: "escape", ctrl: false, text: "" }]);
  });

  test("\\x7f is backspace", () => {
    expect(parseKeys("\x7f")).toEqual([{ name: "backspace", ctrl: false, text: "" }]);
  });

  test("\\b is backspace", () => {
    expect(parseKeys("\b")).toEqual([{ name: "backspace", ctrl: false, text: "" }]);
  });

  test("\\t is tab", () => {
    expect(parseKeys("\t")).toEqual([{ name: "tab", ctrl: false, text: "" }]);
  });

  test("\\x04 is ctrl d", () => {
    expect(parseKeys("\x04")).toEqual([{ name: "d", ctrl: true, text: "" }]);
  });

  test("\\x15 is ctrl u", () => {
    expect(parseKeys("\x15")).toEqual([{ name: "u", ctrl: true, text: "" }]);
  });

  test("\\x13 is ctrl s", () => {
    expect(parseKeys("\x13")).toEqual([{ name: "s", ctrl: true, text: "" }]);
  });

  test("\\x11 is ctrl q", () => {
    expect(parseKeys("\x11")).toEqual([{ name: "q", ctrl: true, text: "" }]);
  });

  test("\\x03 is ctrl c", () => {
    expect(parseKeys("\x03")).toEqual([{ name: "c", ctrl: true, text: "" }]);
  });

  test("any other printable character maps to itself", () => {
    expect(parseKeys("j")).toEqual([{ name: "j", ctrl: false, text: "j" }]);
  });
});

describe("parseKeys — chunking and edge cases", () => {
  test("three printable characters in one chunk return three events in order", () => {
    expect(parseKeys("abc")).toEqual([
      { name: "a", ctrl: false, text: "a" },
      { name: "b", ctrl: false, text: "b" },
      { name: "c", ctrl: false, text: "c" },
    ]);
  });

  test("an arrow sequence followed by a printable character returns both", () => {
    expect(parseKeys("\x1b[Aj")).toEqual([
      { name: "up", ctrl: false, text: "" },
      { name: "j", ctrl: false, text: "j" },
    ]);
  });

  test("an unrecognised escape sequence yields no event", () => {
    expect(parseKeys("\x1b[99~")).toEqual([]);
  });

  test("a mouse sequence yields no event", () => {
    expect(parseKeys("\x1b[<0;10;5M")).toEqual([]);
  });

  test("a mouse sequence followed by a printable character leaves the character intact", () => {
    expect(parseKeys("\x1b[<0;10;5Mj")).toEqual([{ name: "j", ctrl: false, text: "j" }]);
  });

  test("a printable event carries the character in text", () => {
    const [event] = parseKeys("x");

    expect(event?.text).toBe("x");
    expect(event?.name).toBe("x");
  });
});
