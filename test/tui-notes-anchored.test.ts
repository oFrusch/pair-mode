import { describe, expect, test } from "vitest";
import { resolveClick } from "../src/tui/model";
import type { DiffModel, ScreenMap } from "../src/tui/model";
import type { Note } from "../src/tui/notes";
import { bg, fg, noTokens, paintSplit, paintUnified, panelHeight, theme } from "../src/tui/paint";
import type { PaintOptions } from "../src/tui/paint";
import type { Selection } from "../src/tui/selection";

const WIDTH = 80;
const HEIGHT = 20;
const CONNECTOR = "╰─";
const FOCUSED_CONNECTOR = "╰▸";

function buildAnchoredModel(): DiffModel {
  return {
    rows: [
      { kind: "context", left: "aaaa", right: "aaaa", leftNumber: 1, rightNumber: 1 },
      { kind: "add", left: "", right: "bbbb", leftNumber: null, rightNumber: 2 },
      { kind: "del", left: "cccc", right: "", leftNumber: 2, rightNumber: null },
      { kind: "context", left: "dddd", right: "dddd", leftNumber: 3, rightNumber: 3 },
    ],
    folds: [],
    cursor: 0,
  };
}

function buildReplaceModel(): DiffModel {
  return {
    rows: [{ kind: "replace", left: "old text", right: "new text", leftNumber: 1, rightNumber: 1 }],
    folds: [],
    cursor: 0,
  };
}

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 1,
    rowIndex: 0,
    pane: "right",
    startColumn: 0,
    endColumn: 4,
    line: 1,
    code: "aaaa",
    text: "a question",
    ...overrides,
  };
}

function paintOptions(overrides: Partial<PaintOptions> = {}): PaintOptions {
  return {
    model: buildAnchoredModel(),
    width: WIDTH,
    height: HEIGHT,
    path: "f.ts",
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
    notePosition: "anchored",
    ...overrides,
  };
}

function terminalRowIndexFor(map: ScreenMap, modelIndex: number): number {
  const position = map.rows.findIndex((row) => row.kind === "row" && row.index === modelIndex);

  if (position === -1) {
    throw new Error(`terminalRowIndexFor: no row for model index ${modelIndex}`);
  }

  return position + 1;
}

describe("panelHeight — the anchored branch", () => {
  test("with notePosition anchored, panelHeight returns 0 in browse mode with three notes", () => {
    expect(panelHeight(3, "browse", "anchored")).toBe(0);
  });

  test("with notePosition panel, the same input returns a non-zero height", () => {
    expect(panelHeight(3, "browse", "panel")).not.toBe(0);
  });
});

describe("paintSplit — anchored note rows", () => {
  test("a note renders one terminal row after its anchor row, carrying the connector and the note text", () => {
    const note = makeNote({ rowIndex: 0, text: "why here" });
    const { lines, map } = paintSplit(paintOptions({ notes: [note] }));

    const anchorPosition = map.rows.findIndex((row) => row.kind === "row" && row.index === 0);
    const noteLine = lines[anchorPosition + 1];

    expect(noteLine).toContain(CONNECTOR);
    expect(noteLine).toContain("why here");
    expect(map.rows[anchorPosition + 1]).toEqual({ kind: "chrome", index: null });
  });

  test("the focused note's row carries the focused connector", () => {
    const note = makeNote({ id: 7, rowIndex: 0, text: "why here" });
    const { lines, map } = paintSplit(paintOptions({ notes: [note], focusedNote: 7 }));

    const anchorPosition = map.rows.findIndex((row) => row.kind === "row" && row.index === 0);
    const noteLine = lines[anchorPosition + 1];

    expect(noteLine).toContain(FOCUSED_CONNECTOR);
  });

  test("two notes on one anchor row render two consecutive rows in id order", () => {
    const notes = [
      makeNote({ id: 2, rowIndex: 0, text: "second" }),
      makeNote({ id: 1, rowIndex: 0, text: "first" }),
    ];
    const { lines, map } = paintSplit(paintOptions({ notes }));

    const anchorPosition = map.rows.findIndex((row) => row.kind === "row" && row.index === 0);

    expect(lines[anchorPosition + 1]).toContain("first");
    expect(lines[anchorPosition + 2]).toContain("second");
    expect(map.rows[anchorPosition + 1]).toEqual({ kind: "chrome", index: null });
    expect(map.rows[anchorPosition + 2]).toEqual({ kind: "chrome", index: null });
  });

  test("a note row's ScreenRow is chrome with index null", () => {
    const note = makeNote({ rowIndex: 0 });
    const { map } = paintSplit(paintOptions({ notes: [note] }));

    const anchorPosition = map.rows.findIndex((row) => row.kind === "row" && row.index === 0);

    expect(map.rows[anchorPosition + 1]).toEqual({ kind: "chrome", index: null });
  });

  test("resolveClick on a note row returns null", () => {
    const note = makeNote({ rowIndex: 0 });
    const { map } = paintSplit(paintOptions({ notes: [note] }));

    const anchorPosition = map.rows.findIndex((row) => row.kind === "row" && row.index === 0);
    const noteTerminalRow = anchorPosition + 2;

    expect(resolveClick(map, noteTerminalRow, 5)).toBeNull();
  });

  test("the model row after an anchored note resolves to the correct model index through resolveClick", () => {
    const note = makeNote({ rowIndex: 0 });
    const { map } = paintSplit(paintOptions({ notes: [note] }));

    const anchorPosition = map.rows.findIndex((row) => row.kind === "row" && row.index === 0);
    const nextRowPosition = map.rows.findIndex((row, index) => index > anchorPosition && row.kind === "row" && row.index === 1);

    expect(nextRowPosition).toBe(anchorPosition + 2);

    const rightPane = map.panes.find((pane) => pane.pane === "right");
    expect(rightPane).toBeDefined();

    const terminalRow = terminalRowIndexFor(map, 1);
    const target = resolveClick(map, terminalRow, (rightPane?.textStart ?? 0) + 1);

    expect(target).toEqual({ kind: "row", index: 1, pane: "right", column: 0 });
  });

  test("the row marker still renders on the anchor row", () => {
    const note = makeNote({ rowIndex: 0, pane: "right" });
    const { lines, map } = paintSplit(paintOptions({ notes: [note] }));

    const anchorPosition = map.rows.findIndex((row) => row.kind === "row" && row.index === 0);
    const NOTE_FG_TRUECOLOR = fg(theme.note, true);

    expect(lines[anchorPosition]).toContain(NOTE_FG_TRUECOLOR);
  });

  test("in confirm mode the confirm rows render under notePosition anchored", () => {
    const notes = [makeNote({ id: 1 }), makeNote({ id: 2 })];
    const { lines } = paintSplit(paintOptions({ notes, mode: "confirm" }));

    const summaryLine = lines.find((line) => line.includes("notes are not sent"));

    expect(summaryLine).toBeDefined();
  });
});

function selection(overrides: Partial<Selection> = {}): Selection {
  return { pane: "right", anchorRow: 1, anchorColumn: 0, headRow: 1, headColumn: 2, ...overrides };
}

describe("paintSplit — the live draft in note mode", () => {
  test("the draft renders as a note row under the selection's first row", () => {
    const { lines, map } = paintSplit(paintOptions({ mode: "note", draft: "why?", selection: selection() }));

    const anchorPosition = map.rows.findIndex((row) => row.kind === "row" && row.index === 1);
    const draftLine = lines[anchorPosition + 1];

    expect(draftLine).toContain("why?");
    expect(draftLine).toContain(bg(theme.chrome, true));
    expect(map.rows[anchorPosition + 1]).toEqual({ kind: "chrome", index: null });
  });
});

describe("paintUnified — anchored notes on a replace row", () => {
  test("an anchored note on a replace row renders after both terminal rows of that model row", () => {
    const note = makeNote({ rowIndex: 0, pane: "right", text: "which one" });
    const { lines, map } = paintUnified(paintOptions({ model: buildReplaceModel(), notes: [note] }));

    const rowPositions = map.rows.reduce<number[]>((positions, row, index) => {
      return row.kind === "row" && row.index === 0 ? [...positions, index] : positions;
    }, []);

    expect(rowPositions).toHaveLength(2);

    const [firstPosition, secondPosition] = rowPositions;
    const notePosition = (secondPosition ?? 0) + 1;

    expect(lines[notePosition]).toContain(CONNECTOR);
    expect(lines[notePosition]).toContain("which one");
    expect(map.rows[notePosition]).toEqual({ kind: "chrome", index: null });
    expect(firstPosition).toBeDefined();
  });
});
