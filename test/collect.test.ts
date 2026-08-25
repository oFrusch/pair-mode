import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, describe } from "vitest";
import { anchor, collect, formatQuestions, parseNoteResult } from "../src/core/collect";
import type { Question } from "../src/core/collect";

const fixturesDir = join(__dirname, "fixtures/collect");

interface CollectInput {
  original: string[];
  numbers: (number | null)[];
  saved: string[];
}

const caseIds = readdirSync(fixturesDir).sort();

describe("collect against captured fixtures", () => {
  for (const id of caseIds) {
    test(id, () => {
      const input = JSON.parse(
        readFileSync(join(fixturesDir, id, "input.json"), "utf-8"),
      ) as CollectInput;
      const expected = JSON.parse(
        readFileSync(join(fixturesDir, id, "expected.json"), "utf-8"),
      ) as Question[];

      const result = collect(input.original, input.numbers, input.saved);

      expect(result).toEqual(expected);
    });
  }
});

describe("collect", () => {
  test("returns an empty array when saved matches original", () => {
    const original = ["func main() {", "\tx := 1", "}"];
    const numbers = [10, 11, 12];

    expect(collect(original, numbers, [...original])).toEqual([]);
  });

  test("produces no question for a blank line typed by the user", () => {
    const original = ["func main() {", "\tx := 1", "}"];
    const numbers = [10, 11, 12];
    const saved = ["func main() {", "\tx := 1", "   ", "}"];

    expect(collect(original, numbers, saved)).toEqual([]);
  });

  test("anchors a question typed above the first code row to line: null", () => {
    const original = ["func main() {", "}"];
    const numbers = [10, 11];
    const saved = ["what does this do?", "func main() {", "}"];

    const result = collect(original, numbers, saved);

    expect(result).toEqual([{ line: null, code: "", text: "what does this do?" }]);
  });
});

describe("anchor", () => {
  test("returns null when the walk falls off the start", () => {
    const original = ["a", "b"];
    const numbers = [null, null];

    expect(anchor(original, numbers, 1)).toEqual({ line: null, code: "" });
  });

  test("walks backwards to the nearest numbered row", () => {
    const original = ["a", "b", "c"];
    const numbers = [10, null, null];

    expect(anchor(original, numbers, 2)).toEqual({ line: 10, code: "a" });
  });
});

describe("formatQuestions", () => {
  test("output contains the file path and every question text", () => {
    const questions: Question[] = [
      { line: 12, code: "\tfmt.Println(x)", text: "why print x here?" },
      { line: null, code: "", text: "what does this do overall?" },
    ];

    const out = formatQuestions(questions, "/tmp/main.go");

    expect(out).toContain("/tmp/main.go");

    for (const question of questions) {
      expect(out).toContain(question.text);
    }

    expect(out).toContain("  line 12: \tfmt.Println(x)");
    expect(out).not.toContain("line null");
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

describe("parseNoteResult", () => {
  test("a valid document returns its questions", () => {
    const text = JSON.stringify({
      questions: [
        { line: 34, code: "  return fmt(out, opts)", text: "does fmt allocate per call?" },
      ],
    });

    expect(parseNoteResult(text)).toEqual([
      { line: 34, code: "  return fmt(out, opts)", text: "does fmt allocate per call?" },
    ]);
  });

  test("malformed JSON returns an empty array", () => {
    expect(parseNoteResult("{ not json")).toEqual([]);
  });

  test("a non-object root returns an empty array", () => {
    expect(parseNoteResult(JSON.stringify(["a", "b"]))).toEqual([]);
  });

  test("a missing questions key returns an empty array", () => {
    expect(parseNoteResult(JSON.stringify({}))).toEqual([]);
  });

  test("a questions value that is not an array returns an empty array", () => {
    expect(parseNoteResult(JSON.stringify({ questions: "nope" }))).toEqual([]);
  });

  test("a malformed entry drops only itself, and the valid siblings survive", () => {
    const text = JSON.stringify({
      questions: [
        { line: 1, code: "a", text: "first" },
        { line: 2, code: "b" },
        { line: 3, code: "c", text: "second" },
      ],
    });

    expect(parseNoteResult(text)).toEqual([
      { line: 1, code: "a", text: "first" },
      { line: 3, code: "c", text: "second" },
    ]);
  });

  test("an entry whose text trims to empty drops", () => {
    const text = JSON.stringify({ questions: [{ line: 1, code: "a", text: "   " }] });

    expect(parseNoteResult(text)).toEqual([]);
  });

  test("an entry with line: null survives", () => {
    const text = JSON.stringify({ questions: [{ line: null, code: "a", text: "why?" }] });

    expect(parseNoteResult(text)).toEqual([{ line: null, code: "a", text: "why?" }]);
  });

  test("text comes back trimmed", () => {
    const text = JSON.stringify({ questions: [{ line: 1, code: "a", text: "  spaced  " }] });

    expect(parseNoteResult(text)).toEqual([{ line: 1, code: "a", text: "spaced" }]);
  });
});
