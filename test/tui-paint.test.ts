import { test, expect, describe } from "vitest";
import { changedSpans, noTokens, paintSplit, SPAN_SIMILARITY_FLOOR } from "../src/tui/paint";
import { resolveClick } from "../src/tui/model";
import type { DiffModel } from "../src/tui/model";

const ADD_BAR_FG = "\x1b[38;2;63;185;80m";
const ADD_SPAN_BG = "\x1b[48;2;31;91;46m";
const DEL_BAR_FG = "\x1b[38;2;248;81;73m";
const FOLD_FG = "\x1b[38;2;110;118;129m";
const DEFAULT_BG = "\x1b[49m";

const ESCAPE_CHAR = String.fromCharCode(27);
const CSI_PATTERN = "\\[[0-9;]*m";
const ANSI_ESCAPE_PATTERN = new RegExp(ESCAPE_CHAR + CSI_PATTERN, "g");

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "");
}

function buildFixtureModel(): DiffModel {
  return {
    rows: [
      { kind: "context", left: "context line", right: "context line", leftNumber: 1, rightNumber: 1 },
      { kind: "add", left: "", right: "ok", leftNumber: null, rightNumber: 2 },
      { kind: "del", left: "removed line", right: "", leftNumber: 2, rightNumber: null },
      { kind: "replace", left: "const x = 1;", right: "const x = 2;", leftNumber: 3, rightNumber: 3 },
      { kind: "context", left: "ctx4", right: "ctx4", leftNumber: 4, rightNumber: 4 },
      { kind: "context", left: "ctx5", right: "ctx5", leftNumber: 5, rightNumber: 5 },
      { kind: "context", left: "ctx6", right: "ctx6", leftNumber: 6, rightNumber: 6 },
      { kind: "context", left: "ctx7", right: "ctx7", leftNumber: 7, rightNumber: 7 },
      { kind: "context", left: "ctx8", right: "ctx8", leftNumber: 8, rightNumber: 8 },
    ],
    folds: [{ start: 4, count: 5, expanded: false }],
    cursor: 0,
  };
}

const WIDTH = 80;
const HEIGHT = 8;

describe("changedSpans", () => {
  test("a small edit returns spans covering only the changed words", () => {
    const spans = changedSpans("const x = 1;", "const x = 2;");

    expect(spans.left).toEqual([{ start: 10, end: 11 }]);
    expect(spans.right).toEqual([{ start: 10, end: 11 }]);
  });

  test("a fully rewritten line returns one whole-line span per side", () => {
    const before = "the quick brown fox";
    const after = "completely different words entirely";

    const spans = changedSpans(before, after);

    expect(spans.left).toEqual([{ start: 0, end: before.length }]);
    expect(spans.right).toEqual([{ start: 0, end: after.length }]);
  });

  test("an empty side returns an empty list for that side", () => {
    const spans = changedSpans("", "hello world");

    expect(spans.left).toEqual([]);
    expect(spans.right).not.toEqual([]);
  });

  test("SPAN_SIMILARITY_FLOOR is 0.3", () => {
    expect(SPAN_SIMILARITY_FLOOR).toBe(0.3);
  });
});

describe("paintSplit — split layout", () => {
  test("returns exactly height lines", () => {
    const { lines } = paintSplit({
      model: buildFixtureModel(),
      width: WIDTH,
      height: HEIGHT,
      path: "src/example.ts",
      tokens: noTokens,
      truecolor: true,
      rowBand: false,
      scrollTop: 0,
    });

    expect(lines).toHaveLength(HEIGHT);
  });

  test("an added row's right sign bar carries the addBar foreground code", () => {
    const { lines } = paintSplit({
      model: buildFixtureModel(),
      width: WIDTH,
      height: HEIGHT,
      path: "src/example.ts",
      tokens: noTokens,
      truecolor: true,
      rowBand: false,
      scrollTop: 0,
    });

    const addRowLine = lines[3];
    expect(addRowLine).toBeDefined();
    expect(addRowLine).toContain(`${ADD_BAR_FG}▌`);
  });

  test("a removed row's left sign bar carries the delBar foreground code", () => {
    const { lines } = paintSplit({
      model: buildFixtureModel(),
      width: WIDTH,
      height: HEIGHT,
      path: "src/example.ts",
      tokens: noTokens,
      truecolor: true,
      rowBand: false,
      scrollTop: 0,
    });

    const delRowLine = lines[4];
    expect(delRowLine).toBeDefined();
    expect(delRowLine).toContain(`${DEL_BAR_FG}▌`);
  });

  test("a replace row carries the addSpan background somewhere in its right half", () => {
    const { lines } = paintSplit({
      model: buildFixtureModel(),
      width: WIDTH,
      height: HEIGHT,
      path: "src/example.ts",
      tokens: noTokens,
      truecolor: true,
      rowBand: false,
      scrollTop: 0,
    });

    const replaceRowLine = lines[5];
    expect(replaceRowLine).toBeDefined();
    const dividerIndex = replaceRowLine?.indexOf("│") ?? -1;
    expect(dividerIndex).toBeGreaterThan(-1);
    const rightHalf = replaceRowLine?.slice(dividerIndex) ?? "";
    expect(rightHalf).toContain(ADD_SPAN_BG);
  });

  test("with rowBand true, an added row's background stays addSpan through the pane's padding", () => {
    const { lines } = paintSplit({
      model: buildFixtureModel(),
      width: WIDTH,
      height: HEIGHT,
      path: "src/example.ts",
      tokens: noTokens,
      truecolor: true,
      rowBand: true,
      scrollTop: 0,
    });

    const addRowLine = lines[3];
    expect(addRowLine).toBeDefined();
    const dividerIndex = addRowLine?.indexOf("│") ?? -1;
    const rightHalf = addRowLine?.slice(dividerIndex) ?? "";
    const spanStart = rightHalf.indexOf(ADD_SPAN_BG);

    expect(spanStart).toBeGreaterThan(-1);
    expect(rightHalf.indexOf(DEFAULT_BG, spanStart)).toBe(-1);
  });

  test("with rowBand false, the same added row's background turns off after the changed text", () => {
    const { lines } = paintSplit({
      model: buildFixtureModel(),
      width: WIDTH,
      height: HEIGHT,
      path: "src/example.ts",
      tokens: noTokens,
      truecolor: true,
      rowBand: false,
      scrollTop: 0,
    });

    const addRowLine = lines[3];
    expect(addRowLine).toBeDefined();
    const dividerIndex = addRowLine?.indexOf("│") ?? -1;
    const rightHalf = addRowLine?.slice(dividerIndex) ?? "";
    const spanStart = rightHalf.indexOf(ADD_SPAN_BG);

    expect(spanStart).toBeGreaterThan(-1);
    expect(rightHalf.indexOf(DEFAULT_BG, spanStart)).toBeGreaterThan(-1);
  });

  test("a fold row carries the fold label text and the fold foreground code", () => {
    const { lines } = paintSplit({
      model: buildFixtureModel(),
      width: WIDTH,
      height: HEIGHT,
      path: "src/example.ts",
      tokens: noTokens,
      truecolor: true,
      rowBand: false,
      scrollTop: 0,
    });

    const foldRowLine = lines[6];
    expect(foldRowLine).toBeDefined();
    expect(foldRowLine).toContain("⋯ 5 unchanged lines");
    expect(foldRowLine).toContain(FOLD_FG);
  });

  test("the returned ScreenMap has one ScreenRow per emitted line", () => {
    const { lines, map } = paintSplit({
      model: buildFixtureModel(),
      width: WIDTH,
      height: HEIGHT,
      path: "src/example.ts",
      tokens: noTokens,
      truecolor: true,
      rowBand: false,
      scrollTop: 0,
    });

    expect(map.rows).toHaveLength(lines.length);
  });

  test("resolveClick against the returned map resolves a click in the right pane", () => {
    const { map } = paintSplit({
      model: buildFixtureModel(),
      width: WIDTH,
      height: HEIGHT,
      path: "src/example.ts",
      tokens: noTokens,
      truecolor: true,
      rowBand: false,
      scrollTop: 0,
    });

    const rightPane = map.panes.find((pane) => pane.pane === "right");
    expect(rightPane).toBeDefined();

    const terminalRow = 6;
    const sourceColumn = 2;
    const terminalColumn = (rightPane?.textStart ?? 0) + 1 + sourceColumn;

    const target = resolveClick(map, terminalRow, terminalColumn);

    expect(target).toEqual({ kind: "row", index: 3, pane: "right", column: sourceColumn });
  });

  test("a long line truncates to the pane width rather than wrapping", () => {
    const longModel: DiffModel = {
      rows: [
        {
          kind: "context",
          left: "x".repeat(500),
          right: "y".repeat(500),
          leftNumber: 1,
          rightNumber: 1,
        },
      ],
      folds: [],
      cursor: 0,
    };

    const width = 40;
    const height = 4;

    const { lines, map } = paintSplit({
      model: longModel,
      width,
      height,
      path: "src/example.ts",
      tokens: noTokens,
      truecolor: true,
      rowBand: false,
      scrollTop: 0,
    });

    expect(lines).toHaveLength(height);

    const bodyLine = lines[2];
    expect(bodyLine).toBeDefined();
    const plain = stripAnsi(bodyLine ?? "");

    expect(plain).toHaveLength(width);

    const rightPane = map.panes.find((pane) => pane.pane === "right");
    const rightPaneWidth = (rightPane?.textEnd ?? 0) - (rightPane?.textStart ?? 0);

    expect(plain).toContain("y".repeat(rightPaneWidth));
    expect(plain).not.toContain("y".repeat(rightPaneWidth + 1));
  });

  test("lines.length equals height even when height is smaller than the header and status rows", () => {
    const height = 2;

    const { lines, map } = paintSplit({
      model: buildFixtureModel(),
      width: WIDTH,
      height,
      path: "src/example.ts",
      tokens: noTokens,
      truecolor: true,
      rowBand: false,
      scrollTop: 0,
    });

    expect(lines).toHaveLength(height);
    expect(map.rows).toHaveLength(height);
  });

  test("lines.length equals height when height is 1", () => {
    const height = 1;

    const { lines, map } = paintSplit({
      model: buildFixtureModel(),
      width: WIDTH,
      height,
      path: "src/example.ts",
      tokens: noTokens,
      truecolor: true,
      rowBand: false,
      scrollTop: 0,
    });

    expect(lines).toHaveLength(height);
    expect(map.rows).toHaveLength(height);
  });
});
