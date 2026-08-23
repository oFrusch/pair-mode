import { test, expect, describe } from "vitest";
import { chooseLayout, MIN_SPLIT_WIDTH, noTokens, paint, paintUnified } from "../src/tui/paint";
import { resolveClick } from "../src/tui/model";
import type { DiffModel } from "../src/tui/model";
import type { PaintOptions } from "../src/tui/paint";

const ADD_BAR_FG = "\x1b[38;2;63;185;80m";
const DEL_BAR_FG = "\x1b[38;2;248;81;73m";

const NUMBER_WIDTH_FLOOR = 2;
const GUTTER_SPACE_WIDTH = 1;
const SIGN_BAR_WIDTH = 1;
const TEXT_GAP_WIDTH = 1;

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
      { kind: "add", left: "", right: "added line", leftNumber: null, rightNumber: 2 },
      { kind: "del", left: "removed line", right: "", leftNumber: 2, rightNumber: null },
      { kind: "replace", left: "const x = 1;", right: "const x = 2;", leftNumber: 3, rightNumber: 3 },
    ],
    folds: [],
    cursor: 0,
  };
}

function buildNewFileModel(): DiffModel {
  return {
    rows: [
      { kind: "context", left: "context line", right: "context line", leftNumber: 1, rightNumber: 1 },
      { kind: "add", left: "", right: "added line", leftNumber: null, rightNumber: 2 },
    ],
    folds: [],
    cursor: 0,
  };
}

function baseOptions(overrides: Partial<PaintOptions> = {}): PaintOptions {
  return {
    model: buildFixtureModel(),
    width: 100,
    height: 8,
    path: "src/example.ts",
    tokens: noTokens,
    truecolor: true,
    rowBand: false,
    scrollTop: 0,
    layout: "split",
    ...overrides,
  };
}

describe("chooseLayout", () => {
  test("a model with only add and context rows returns unified even at width 200 with layout split", () => {
    const layout = chooseLayout(baseOptions({ model: buildNewFileModel(), width: 200, layout: "split" }));

    expect(layout).toBe("unified");
  });

  test("a width of 89 returns unified with layout split", () => {
    const layout = chooseLayout(baseOptions({ width: 89, layout: "split" }));

    expect(layout).toBe("unified");
  });

  test("a width of 90 with a replace row and layout split returns split", () => {
    const layout = chooseLayout(baseOptions({ width: MIN_SPLIT_WIDTH, layout: "split" }));

    expect(layout).toBe("split");
  });

  test("layout unified at width 200 returns unified", () => {
    const layout = chooseLayout(baseOptions({ width: 200, layout: "unified" }));

    expect(layout).toBe("unified");
  });
});

describe("paintUnified — one-column layout", () => {
  test("returns exactly height lines", () => {
    const { lines } = paintUnified(baseOptions());

    expect(lines).toHaveLength(8);
  });

  test("a replace model row produces two terminal rows", () => {
    const { map } = paintUnified(baseOptions());

    const replaceRows = map.rows.filter((row) => row.kind === "row" && row.index === 3);

    expect(replaceRows).toHaveLength(2);
  });

  test("those two terminal rows carry the same model index in the ScreenMap", () => {
    const { map } = paintUnified(baseOptions());

    const replaceRows = map.rows.filter((row) => row.kind === "row" && row.index === 3);

    expect(replaceRows[0]?.index).toBe(3);
    expect(replaceRows[1]?.index).toBe(3);
  });

  test("the removed terminal row carries the delBar foreground code, the added row carries addBar", () => {
    const { lines, map } = paintUnified(baseOptions());

    const replaceLineIndexes = map.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.kind === "row" && row.index === 3)
      .map(({ index }) => index);

    const removedLine = lines[replaceLineIndexes[0] ?? -1];
    const addedLine = lines[replaceLineIndexes[1] ?? -1];

    expect(removedLine).toContain(DEL_BAR_FG);
    expect(addedLine).toContain(ADD_BAR_FG);
  });

  test("the gutter on a del row shows leftNumber, and on an add row shows rightNumber", () => {
    const { lines } = paintUnified(baseOptions());

    const addLine = lines[3];
    const delLine = lines[4];

    expect(addLine).toBeDefined();
    expect(delLine).toBeDefined();
    expect(stripAnsi(addLine ?? "")).toContain("2");
    expect(stripAnsi(delLine ?? "")).toContain("2");
  });

  test("map.panes has length 1 with pane right", () => {
    const { map } = paintUnified(baseOptions());

    expect(map.panes).toHaveLength(1);
    expect(map.panes[0]?.pane).toBe("right");
  });

  test("resolveClick on the added half of a replace returns that model row index", () => {
    const { map } = paintUnified(baseOptions());

    const addedLineIndex = map.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.kind === "row" && row.index === 3)
      .map(({ index }) => index)[1];

    expect(addedLineIndex).toBeDefined();

    const rightPane = map.panes[0];
    expect(rightPane).toBeDefined();

    const terminalRow = (addedLineIndex ?? 0) + 1;
    const terminalColumn = (rightPane?.textStart ?? 0) + 1;

    const target = resolveClick(map, terminalRow, terminalColumn);

    expect(target).toMatchObject({ kind: "row", index: 3, pane: "right" });
  });

  test("a long line truncates rather than wraps", () => {
    const longModel: DiffModel = {
      rows: [
        { kind: "context", left: "x".repeat(500), right: "y".repeat(500), leftNumber: 1, rightNumber: 1 },
      ],
      folds: [],
      cursor: 0,
    };

    const width = 40;
    const height = 4;

    const { lines } = paintUnified(baseOptions({ model: longModel, width, height }));

    expect(lines).toHaveLength(height);

    const bodyLine = lines[2];
    expect(bodyLine).toBeDefined();
    const plain = stripAnsi(bodyLine ?? "");

    expect(plain).toHaveLength(width);

    const numberWidth = NUMBER_WIDTH_FLOOR;
    const expectedPaneWidth = width - numberWidth - GUTTER_SPACE_WIDTH - SIGN_BAR_WIDTH - TEXT_GAP_WIDTH;

    expect(plain).toContain("y".repeat(expectedPaneWidth));
    expect(plain).not.toContain("y".repeat(expectedPaneWidth + 1));
  });
});

describe("status bar layout override reason", () => {
  test("a new-file model's status bar contains whole file is new", () => {
    const { lines } = paint(baseOptions({ model: buildNewFileModel(), width: 200, layout: "split" }));

    const statusLine = lines[lines.length - 1];
    expect(statusLine).toBeDefined();
    expect(stripAnsi(statusLine ?? "")).toContain("whole file is new");
  });

  test("a width-below-90 model's status bar contains narrow · unified", () => {
    const { lines } = paint(baseOptions({ width: 50, layout: "split" }));

    const statusLine = lines[lines.length - 1];
    expect(statusLine).toBeDefined();
    expect(stripAnsi(statusLine ?? "")).toContain("narrow · unified");
  });

  test("a normal split render's status bar contains neither", () => {
    const { lines } = paint(baseOptions({ width: 200, layout: "split" }));

    const statusLine = lines[lines.length - 1];
    expect(statusLine).toBeDefined();
    const plain = stripAnsi(statusLine ?? "");

    expect(plain).not.toContain("whole file is new");
    expect(plain).not.toContain("narrow · unified");
  });
});
