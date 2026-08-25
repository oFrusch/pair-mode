import { describe, expect, test } from "vitest";
import type { DiffModel } from "../src/tui/model";
import { noteFromSelection, toQuestions } from "../src/tui/notes";
import type { Note } from "../src/tui/notes";
import { bg, noTokens, paintSplit, theme } from "../src/tui/paint";
import type { PaintOptions } from "../src/tui/paint";
import type { Selection } from "../src/tui/selection";

const WIDTH = 80;
const HEIGHT = 24;
const CONNECTOR = "╰─";
const NOTE_MARKER = "●";
const SELECTION_BG = bg(theme.selection, true);
const ESCAPE = String.fromCharCode(27);
const ESCAPE_PATTERN = new RegExp(`(${ESCAPE}\\[[0-9;]*m)`);

function buildRangeModel(): DiffModel {
  return {
    rows: [
      { kind: "context", left: "aaaaaaaa", right: "aaaaaaaa", leftNumber: 1, rightNumber: 1 },
      { kind: "context", left: "bbbbbbbb", right: "bbbbbbbb", leftNumber: 2, rightNumber: 2 },
      { kind: "context", left: "cccccccc", right: "cccccccc", leftNumber: 3, rightNumber: 3 },
      { kind: "context", left: "dddddddd", right: "dddddddd", leftNumber: 4, rightNumber: 4 },
      { kind: "context", left: "eeeeeeee", right: "eeeeeeee", leftNumber: 5, rightNumber: 5 },
    ],
    folds: [],
    cursor: 0,
  };
}

function selection(overrides: Partial<Selection> = {}): Selection {
  return { pane: "right", anchorRow: 1, anchorColumn: 2, headRow: 3, headColumn: 4, ...overrides };
}

function paintOptions(overrides: Partial<PaintOptions> = {}): PaintOptions {
  return {
    model: buildRangeModel(),
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
    notePosition: "panel",
    ...overrides,
  };
}

function makeNote(model: DiffModel, from: Selection): Note {
  const note = noteFromSelection(model, from, 1, "why here");

  if (note === null) {
    throw new Error("makeNote: noteFromSelection returned null");
  }

  return note;
}

function isBackgroundEscape(token: string): boolean {
  return token.startsWith("\x1b[48") || token === "\x1b[49m" || token === "\x1b[0m";
}

// The renderer emits a background escape only when the colour changes, so track it across tokens.
function highlightedText(line: string): string {
  const scan = line.split(ESCAPE_PATTERN).reduce(
    (state, token) => {
      if (ESCAPE_PATTERN.test(token)) {
        if (token === SELECTION_BG) {
          return { ...state, highlighted: true };
        }

        return isBackgroundEscape(token) ? { ...state, highlighted: false } : state;
      }

      return state.highlighted ? { ...state, text: state.text + token } : state;
    },
    { text: "", highlighted: false },
  );

  return scan.text;
}

function terminalRowFor(lines: string[], marker: string): number {
  return lines.findIndex((line) => line.includes(marker));
}

describe("noteFromSelection — a multi-row selection", () => {
  test("a three-row selection produces one note whose range covers all three rows", () => {
    const note = makeNote(buildRangeModel(), selection());

    expect(note.rowIndex).toBe(1);
    expect(note.endRowIndex).toBe(3);
    expect(note.startColumn).toBe(2);
    expect(note.endColumn).toBe(5);
  });

  test("the note carries the first row's line and the last row's end line", () => {
    const note = makeNote(buildRangeModel(), selection());

    expect(note.line).toBe(2);
    expect(note.endLine).toBe(4);
    expect(note.code).toBe("bbbbbbbb");
  });

  test("a reversed drag produces the same range as the forward drag", () => {
    const forward = makeNote(buildRangeModel(), selection());
    const reversed = makeNote(
      buildRangeModel(),
      selection({ anchorRow: 3, anchorColumn: 4, headRow: 1, headColumn: 2 }),
    );

    expect(reversed).toEqual(forward);
  });

  test("a single-row selection keeps its columns and ends on its own row", () => {
    const note = makeNote(
      buildRangeModel(),
      selection({ anchorRow: 1, anchorColumn: 2, headRow: 1, headColumn: 4 }),
    );

    expect(note.rowIndex).toBe(1);
    expect(note.endRowIndex).toBe(note.rowIndex);
    expect(note.startColumn).toBe(2);
    expect(note.endColumn).toBe(5);
  });
});

describe("toQuestions — a multi-row note", () => {
  test("the question keeps the first row's line number", () => {
    const [question] = toQuestions([makeNote(buildRangeModel(), selection())]);

    expect(question?.line).toBe(2);
    expect(question?.code).toBe("bbbbbbbb");
  });

  test("a multi-row note and the equivalent single-row note produce the same question", () => {
    const model = buildRangeModel();
    const multiRow = makeNote(model, selection());
    const singleRow = makeNote(
      model,
      selection({ anchorRow: 1, anchorColumn: 2, headRow: 1, headColumn: 7 }),
    );

    expect(toQuestions([multiRow])).toEqual(toQuestions([singleRow]));
  });

  test("a multi-row note starting at column zero produces the bare text", () => {
    const [question] = toQuestions([makeNote(buildRangeModel(), selection({ anchorColumn: 0 }))]);

    expect(question?.text).toBe("why here");
  });
});

describe("paintSplit — the marker column across a note's range", () => {
  test("every row in the range carries the marker, and the rows outside it do not", () => {
    const note = makeNote(buildRangeModel(), selection());
    const { lines, map } = paintSplit(paintOptions({ notes: [note] }));

    const markerRows = map.rows
      .map((row, index) => ({ row, index }))
      .filter((entry) => entry.row.kind === "row" && lines[entry.index]?.includes(NOTE_MARKER))
      .map((entry) => (entry.row.kind === "row" ? entry.row.index : null));

    expect(markerRows).toEqual([1, 2, 3]);
  });
});

describe("paintSplit — the highlight spans across a note's range", () => {
  test("the first row is highlighted from the start column to end of line", () => {
    const note = makeNote(buildRangeModel(), selection());
    const { lines, map } = paintSplit(paintOptions({ notes: [note] }));

    const position = map.rows.findIndex((row) => row.kind === "row" && row.index === 1);

    expect(highlightedText(lines[position] ?? "")).toBe("bbbbbb");
  });

  test("the middle row is highlighted for the whole line", () => {
    const note = makeNote(buildRangeModel(), selection());
    const { lines, map } = paintSplit(paintOptions({ notes: [note] }));

    const position = map.rows.findIndex((row) => row.kind === "row" && row.index === 2);

    expect(highlightedText(lines[position] ?? "")).toBe("cccccccc");
  });

  test("the last row is highlighted from column zero to the end column", () => {
    const note = makeNote(buildRangeModel(), selection());
    const { lines, map } = paintSplit(paintOptions({ notes: [note] }));

    const position = map.rows.findIndex((row) => row.kind === "row" && row.index === 3);

    expect(highlightedText(lines[position] ?? "")).toBe("ddddd");
  });

  test("a single-row note highlights only its own columns", () => {
    const note = makeNote(
      buildRangeModel(),
      selection({ anchorRow: 1, anchorColumn: 2, headRow: 1, headColumn: 4 }),
    );
    const { lines, map } = paintSplit(paintOptions({ notes: [note] }));

    const position = map.rows.findIndex((row) => row.kind === "row" && row.index === 1);

    expect(highlightedText(lines[position] ?? "")).toBe("bbb");
  });
});

describe("paintSplit — the anchored connector for a multi-row note", () => {
  test("the connector renders under the last row of the range", () => {
    const note = makeNote(buildRangeModel(), selection());
    const { lines, map } = paintSplit(paintOptions({ notes: [note], notePosition: "anchored" }));

    const lastRow = map.rows.findIndex((row) => row.kind === "row" && row.index === 3);
    const connectorRow = terminalRowFor(lines, CONNECTOR);

    expect(connectorRow).toBe(lastRow + 1);
    expect(lines[connectorRow]).toContain("why here");
  });

  test("the docked panel row reads as a line range", () => {
    const note = makeNote(buildRangeModel(), selection());
    const { lines } = paintSplit(paintOptions({ notes: [note] }));

    const panelRow = lines.find((line) => line.includes("why here"));

    expect(panelRow).toContain("L2-4");
  });

  test("a single-row note's panel row keeps the bare line label", () => {
    const note = makeNote(
      buildRangeModel(),
      selection({ anchorRow: 1, anchorColumn: 2, headRow: 1, headColumn: 4 }),
    );
    const { lines } = paintSplit(paintOptions({ notes: [note] }));

    const panelRow = lines.find((line) => line.includes("why here"));

    expect(panelRow).toContain("L2 ");
    expect(panelRow).not.toContain("L2-");
  });
});
