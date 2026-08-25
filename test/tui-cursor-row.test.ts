import { describe, expect, test } from "vitest";
import { noTokens, paintSplit, paintUnified } from "../src/tui/paint";
import type { DiffModel } from "../src/tui/model";
import type { PaintOptions } from "../src/tui/paint";

const CHROME_FG = "\x1b[38;2;232;163;61m";
const FOLD_FG = "\x1b[38;2;110;118;129m";

const HEADER_ROWS = 2;
const WIDTH = 80;
const HEIGHT = 12;

function buildModel(cursor: number): DiffModel {
  return {
    rows: [
      { kind: "context", left: "one", right: "one", leftNumber: 1, rightNumber: 1 },
      { kind: "context", left: "two", right: "two", leftNumber: 2, rightNumber: 2 },
      { kind: "context", left: "three", right: "three", leftNumber: 3, rightNumber: 3 },
      { kind: "context", left: "four", right: "four", leftNumber: 4, rightNumber: 4 },
      { kind: "context", left: "five", right: "five", leftNumber: 5, rightNumber: 5 },
    ],
    folds: [],
    cursor,
  };
}

function buildFoldedModel(cursor: number): DiffModel {
  return {
    rows: [
      { kind: "context", left: "one", right: "one", leftNumber: 1, rightNumber: 1 },
      { kind: "context", left: "two", right: "two", leftNumber: 2, rightNumber: 2 },
      { kind: "context", left: "three", right: "three", leftNumber: 3, rightNumber: 3 },
      { kind: "context", left: "four", right: "four", leftNumber: 4, rightNumber: 4 },
    ],
    folds: [{ start: 1, count: 2, expanded: false }],
    cursor,
  };
}

function baseOptions(overrides: Partial<PaintOptions> = {}): PaintOptions {
  return {
    model: buildModel(0),
    width: WIDTH,
    height: HEIGHT,
    path: "src/example.ts",
    tokens: noTokens,
    truecolor: true,
    rowBand: false,
    scrollTop: 0,
    layout: "split",
    selection: null,
    mode: "browse",
    draft: "",
    notes: [],
    focusedNote: null,
    notePosition: "panel",
    ...overrides,
  };
}

function bodyLine(lines: string[], offset: number): string {
  const line = lines[HEADER_ROWS + offset];

  if (line === undefined) {
    throw new Error(`body line missing at offset: ${offset}`);
  }

  return line;
}

function countOccurrences(line: string, needle: string): number {
  return line.split(needle).length - 1;
}

describe("paintSplit — the cursor row gutter", () => {
  test("the cursor row opens with the chrome escape and a non-cursor row opens with the fold escape", () => {
    const { lines } = paintSplit(baseOptions({ model: buildModel(2) }));

    expect(bodyLine(lines, 2).startsWith(CHROME_FG + " 3 ")).toBe(true);
    expect(bodyLine(lines, 1).startsWith(FOLD_FG + " 2 ")).toBe(true);
  });

  test("both gutters on the cursor row carry the chrome escape", () => {
    const { lines } = paintSplit(baseOptions({ model: buildModel(2) }));

    expect(countOccurrences(bodyLine(lines, 2), CHROME_FG)).toBe(2);
    expect(countOccurrences(bodyLine(lines, 1), CHROME_FG)).toBe(0);
  });

  test("a moved cursor moves the chrome gutter to the new row", () => {
    const first = paintSplit(baseOptions({ model: buildModel(1) }));
    const second = paintSplit(baseOptions({ model: buildModel(3) }));

    expect(bodyLine(first.lines, 1).startsWith(CHROME_FG)).toBe(true);
    expect(bodyLine(first.lines, 3).startsWith(FOLD_FG)).toBe(true);

    expect(bodyLine(second.lines, 3).startsWith(CHROME_FG)).toBe(true);
    expect(bodyLine(second.lines, 1).startsWith(FOLD_FG)).toBe(true);
  });

  test("a collapsed fold row on the cursor paints its label in chrome", () => {
    const { lines } = paintSplit(baseOptions({ model: buildFoldedModel(1) }));

    expect(bodyLine(lines, 1).startsWith(CHROME_FG)).toBe(true);
    expect(bodyLine(lines, 1)).toContain("unchanged lines");
  });

  test("a collapsed fold row away from the cursor keeps its fold label", () => {
    const { lines } = paintSplit(baseOptions({ model: buildFoldedModel(0) }));

    expect(bodyLine(lines, 1).startsWith(FOLD_FG)).toBe(true);
    expect(bodyLine(lines, 1)).toContain("unchanged lines");
  });

  test("a scrolled cursor row keeps the chrome gutter at its own visible index", () => {
    const scrolled = paintSplit(baseOptions({ model: buildModel(3), scrollTop: 2 }));
    const unscrolled = paintSplit(baseOptions({ model: buildModel(3), scrollTop: 0 }));

    // With scrollTop 2 the cursor at visible index 3 lands on screen offset 1.
    expect(bodyLine(scrolled.lines, 1).startsWith(CHROME_FG + " 4 ")).toBe(true);
    expect(bodyLine(scrolled.lines, 0).startsWith(FOLD_FG + " 3 ")).toBe(true);

    // The same screen offset with no scroll holds visible index 1, which is not the cursor.
    expect(bodyLine(unscrolled.lines, 1).startsWith(FOLD_FG + " 2 ")).toBe(true);
  });
});

describe("paintUnified — the cursor row gutter", () => {
  test("the cursor row opens with the chrome escape and a non-cursor row opens with the fold escape", () => {
    const { lines } = paintUnified(baseOptions({ model: buildModel(2), layout: "unified" }));

    expect(bodyLine(lines, 2).startsWith(CHROME_FG + " 3 ")).toBe(true);
    expect(bodyLine(lines, 1).startsWith(FOLD_FG + " 2 ")).toBe(true);
  });

  test("the unified cursor row carries exactly one chrome gutter", () => {
    const { lines } = paintUnified(baseOptions({ model: buildModel(2), layout: "unified" }));

    expect(countOccurrences(bodyLine(lines, 2), CHROME_FG)).toBe(1);
    expect(countOccurrences(bodyLine(lines, 1), CHROME_FG)).toBe(0);
  });

  test("a moved cursor moves the chrome gutter to the new row", () => {
    const first = paintUnified(baseOptions({ model: buildModel(1), layout: "unified" }));
    const second = paintUnified(baseOptions({ model: buildModel(3), layout: "unified" }));

    expect(bodyLine(first.lines, 1).startsWith(CHROME_FG)).toBe(true);
    expect(bodyLine(first.lines, 3).startsWith(FOLD_FG)).toBe(true);

    expect(bodyLine(second.lines, 3).startsWith(CHROME_FG)).toBe(true);
    expect(bodyLine(second.lines, 1).startsWith(FOLD_FG)).toBe(true);
  });

  test("a collapsed fold row on the cursor paints its label in chrome", () => {
    const { lines } = paintUnified(baseOptions({ model: buildFoldedModel(1), layout: "unified" }));

    expect(bodyLine(lines, 1).startsWith(CHROME_FG)).toBe(true);
    expect(bodyLine(lines, 1)).toContain("unchanged lines");
  });

  test("a scrolled cursor row keeps the chrome gutter at its own visible index", () => {
    const scrolled = paintUnified(
      baseOptions({ model: buildModel(3), layout: "unified", scrollTop: 2 }),
    );
    const unscrolled = paintUnified(
      baseOptions({ model: buildModel(3), layout: "unified", scrollTop: 0 }),
    );

    // With scrollTop 2 the cursor at visible index 3 lands on screen offset 1.
    expect(bodyLine(scrolled.lines, 1).startsWith(CHROME_FG + " 4 ")).toBe(true);
    expect(bodyLine(scrolled.lines, 0).startsWith(FOLD_FG + " 3 ")).toBe(true);

    // The same screen offset with no scroll holds visible index 1, which is not the cursor.
    expect(bodyLine(unscrolled.lines, 1).startsWith(FOLD_FG + " 2 ")).toBe(true);
  });
});
