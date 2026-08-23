import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { parseNoteResult } from "../src/core/collect";
import { resolveClick } from "../src/tui/model";
import type { DiffModel } from "../src/tui/model";
import { noteFromSelection, toQuestions, writeResult } from "../src/tui/notes";
import type { Note } from "../src/tui/notes";
import { bodyHeight, noTokens, paintSplit, panelHeight } from "../src/tui/paint";
import type { Selection } from "../src/tui/selection";
import { applyKey, deleteNote, runTui } from "../src/tui/tui";
import type { TuiIo, TuiOptions, TuiState } from "../src/tui/tui.types";
import type { KeyEvent } from "../src/tui/input/input.types";

function tempPath(): string {
  return join(tmpdir(), `pair-mode-notes-test-${randomBytes(6).toString("hex")}.json`);
}

function buildNotesModel(): DiffModel {
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

function selection(overrides: Partial<Selection> = {}): Selection {
  return { pane: "right", anchorRow: 0, anchorColumn: 0, headRow: 0, headColumn: 3, ...overrides };
}

describe("noteFromSelection", () => {
  test("a right-pane selection takes rightNumber and the right text", () => {
    const note = noteFromSelection(buildNotesModel(), selection({ pane: "right", anchorRow: 0, headRow: 0 }), 1, "hi");

    expect(note?.line).toBe(1);
    expect(note?.code).toBe("aaaa");
    expect(note?.pane).toBe("right");
  });

  test("a left-pane selection takes leftNumber and the left text", () => {
    const note = noteFromSelection(
      buildNotesModel(),
      selection({ pane: "left", anchorRow: 2, headRow: 2, anchorColumn: 0, headColumn: 3 }),
      1,
      "hi",
    );

    expect(note?.line).toBe(2);
    expect(note?.code).toBe("cccc");
    expect(note?.pane).toBe("left");
  });

  test("a row with a null number produces a note with line null", () => {
    const note = noteFromSelection(
      buildNotesModel(),
      selection({ pane: "left", anchorRow: 1, headRow: 1, anchorColumn: 0, headColumn: 0 }),
      1,
      "hi",
    );

    expect(note?.line).toBeNull();
  });

  test("an empty text returns null", () => {
    expect(noteFromSelection(buildNotesModel(), selection(), 1, "")).toBeNull();
  });

  test("a whitespace-only text returns null", () => {
    expect(noteFromSelection(buildNotesModel(), selection(), 1, "   ")).toBeNull();
  });
});

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

describe("toQuestions", () => {
  test("a whole-line note produces the bare text", () => {
    const [question] = toQuestions([makeNote({ startColumn: 0, endColumn: 4, code: "aaaa", text: "why" })]);

    expect(question?.text).toBe("why");
  });

  test("a partial-span note appends the quoted selected text", () => {
    const [question] = toQuestions([makeNote({ startColumn: 1, endColumn: 3, code: "aaaa", text: "why" })]);

    expect(question?.text).toBe('why [re: "aa"]');
  });

  test("a note with line null keeps line null", () => {
    const [question] = toQuestions([makeNote({ line: null })]);

    expect(question?.line).toBeNull();
  });

  test("the output keeps the input note order", () => {
    const notes = [makeNote({ id: 1, text: "first" }), makeNote({ id: 2, text: "second" })];

    expect(toQuestions(notes).map((question) => question.text)).toEqual(["first", "second"]);
  });
});

describe("writeResult", () => {
  test("the written file parses back through parseNoteResult to the same questions", () => {
    const path = tempPath();
    const notes = [makeNote({ id: 1, text: "why this" }), makeNote({ id: 2, rowIndex: 1, text: "and this" })];

    writeResult(path, notes);

    const parsed = parseNoteResult(readFileSync(path, "utf-8"));

    expect(parsed).toEqual(toQuestions(notes));

    unlinkSync(path);
  });

  test("zero notes writes a document with an empty array", () => {
    const path = tempPath();

    writeResult(path, []);

    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ questions: [] });

    unlinkSync(path);
  });

  test("an unwritable path does not throw", () => {
    expect(() => writeResult("/no/such/directory/result.json", [])).not.toThrow();
  });
});

function makeState(overrides: Partial<TuiState> = {}): TuiState {
  return {
    model: buildNotesModel(),
    mode: "browse",
    scrollTop: 0,
    map: { rows: [], panes: [] },
    layout: "split",
    quit: "none",
    selection: null,
    notes: [],
    focusedNote: null,
    draft: "",
    nextNoteId: 1,
    notePosition: "panel",
    ...overrides,
  };
}

function key(name: string, ctrl = false, text = ""): KeyEvent {
  return { name, ctrl, text };
}

describe("applyKey — a and note drafting", () => {
  test("a with a selection enters note mode", () => {
    const state = makeState({ selection: selection() });

    const next = applyKey(state, key("a"), 24);

    expect(next.mode).toBe("note");
    expect(next.draft).toBe("");
  });

  test("a with no selection selects the cursor row and enters note mode", () => {
    const state = makeState({ model: { ...buildNotesModel(), cursor: 0 } });

    const next = applyKey(state, key("a"), 24);

    expect(next.mode).toBe("note");
    expect(next.selection).not.toBeNull();
  });

  test("typing appends to the draft, and backspace removes", () => {
    const noted = applyKey(makeState({ selection: selection() }), key("a"), 24);

    const typed = applyKey(applyKey(noted, key("h", false, "h"), 24), key("i", false, "i"), 24);
    expect(typed.draft).toBe("hi");

    const backspaced = applyKey(typed, key("backspace"), 24);
    expect(backspaced.draft).toBe("h");
  });

  test("enter commits a note and clears the draft and the selection", () => {
    const typed = { ...applyKey(makeState({ selection: selection() }), key("a"), 24), draft: "why" };

    const next = applyKey(typed, key("enter"), 24);

    expect(next.notes).toHaveLength(1);
    expect(next.draft).toBe("");
    expect(next.selection).toBeNull();
    expect(next.mode).toBe("browse");
  });

  test("enter on an empty draft commits nothing", () => {
    const noted = applyKey(makeState({ selection: selection() }), key("a"), 24);

    const next = applyKey(noted, key("enter"), 24);

    expect(next.notes).toHaveLength(0);
  });

  test("escape in note discards", () => {
    const typed = { ...applyKey(makeState({ selection: selection() }), key("a"), 24), draft: "why" };

    const next = applyKey(typed, key("escape"), 24);

    expect(next.mode).toBe("browse");
    expect(next.draft).toBe("");
    expect(next.notes).toHaveLength(0);
  });

  test("no reducer in this describe block mutates its input state", () => {
    const state = makeState({ selection: selection() });
    const clone = structuredClone(state);

    applyKey(state, key("a"), 24);

    expect(state).toEqual(clone);
  });
});

function threeNotes(): Note[] {
  return [
    makeNote({ id: 1, rowIndex: 0, text: "first" }),
    makeNote({ id: 2, rowIndex: 1, text: "second" }),
    makeNote({ id: 3, rowIndex: 3, text: "third" }),
  ];
}

describe("applyKey — tab and d", () => {
  test("tab cycles focus by id and wraps", () => {
    const state = makeState({ notes: threeNotes() });

    const first = applyKey(state, key("tab"), 24);
    expect(first.focusedNote).toBe(1);

    const second = applyKey(first, key("tab"), 24);
    expect(second.focusedNote).toBe(2);

    const third = applyKey(second, key("tab"), 24);
    expect(third.focusedNote).toBe(3);

    const wrapped = applyKey(third, key("tab"), 24);
    expect(wrapped.focusedNote).toBe(1);
  });

  test("d deletes the focused note and moves focus", () => {
    const state = makeState({ notes: threeNotes(), focusedNote: 1 });

    const next = applyKey(state, key("d", false, "d"), 24);

    expect(next.notes.map((note) => note.id)).toEqual([2, 3]);
    expect(next.focusedNote).toBe(2);
  });

  test("d on the last remaining note sets focus to null", () => {
    const state = makeState({ notes: [makeNote({ id: 1 })], focusedNote: 1 });

    const next = applyKey(state, key("d", false, "d"), 24);

    expect(next.notes).toHaveLength(0);
    expect(next.focusedNote).toBeNull();
  });

  test("focus survives a delete of an earlier note", () => {
    const state = makeState({ notes: threeNotes(), focusedNote: 3 });

    const next = deleteNote(state, 1);

    expect(next.notes.map((note) => note.id)).toEqual([2, 3]);
    expect(next.focusedNote).toBe(3);
  });
});

describe("applyKey — quit and confirm", () => {
  test("ctrl q with zero notes quits clean", () => {
    const state = makeState();

    const next = applyKey(state, key("q", true), 24);

    expect(next.quit).toBe("clean");
  });

  test("ctrl q with notes enters confirm", () => {
    const state = makeState({ notes: threeNotes() });

    const next = applyKey(state, key("q", true), 24);

    expect(next.mode).toBe("confirm");
    expect(next.quit).toBe("none");
  });

  test("s in confirm sends", () => {
    const state = makeState({ notes: threeNotes(), mode: "confirm" });

    const next = applyKey(state, key("s", false, "s"), 24);

    expect(next.quit).toBe("send");
  });

  test("d in confirm discards", () => {
    const state = makeState({ notes: threeNotes(), mode: "confirm" });

    const next = applyKey(state, key("d", false, "d"), 24);

    expect(next.quit).toBe("clean");
  });

  test("escape in confirm returns to browse", () => {
    const state = makeState({ notes: threeNotes(), mode: "confirm" });

    const next = applyKey(state, key("escape"), 24);

    expect(next.mode).toBe("browse");
    expect(next.quit).toBe("none");
  });
});

describe("panelHeight", () => {
  test("returns 0 with no notes", () => {
    expect(panelHeight(0, "browse", "panel")).toBe(0);
  });

  test("caps at 6", () => {
    expect(panelHeight(50, "browse", "panel")).toBe(6);
  });
});

function paintOptions(overrides: Partial<Parameters<typeof paintSplit>[0]> = {}) {
  return {
    model: buildNotesModel(),
    width: 80,
    height: 16,
    path: "f.ts",
    tokens: noTokens,
    truecolor: true,
    rowBand: false,
    scrollTop: 0,
    layout: "split" as const,
    selection: null,
    mode: "browse" as const,
    draft: "",
    notes: [] as Note[],
    focusedNote: null as number | null,
    notePosition: "panel" as const,
    ...overrides,
  };
}

describe("paint — the docked panel and the row marker", () => {
  test("the panel title shows the note count", () => {
    const { lines } = paintSplit(paintOptions({ notes: [makeNote(), makeNote({ id: 2 })] }));

    const titleLine = lines.find((line) => line.includes("NOTES"));

    expect(titleLine).toContain("NOTES (2)");
  });

  test("the focused note's row carries the focus marker, the others carry the plain marker", () => {
    const notes = [makeNote({ id: 1, text: "one" }), makeNote({ id: 2, text: "two" })];
    const { lines } = paintSplit(paintOptions({ notes, focusedNote: 2 }));

    const focusedLine = lines.find((line) => line.includes("two"));
    const plainLine = lines.find((line) => line.includes("one"));

    expect(focusedLine).toContain("▸");
    expect(plainLine).toContain("●");
    expect(plainLine).not.toContain("▸");
  });

  test("an annotated model row carries the note colour marker", () => {
    const note = makeNote({ rowIndex: 0, pane: "right" });
    const { lines } = paintSplit(paintOptions({ notes: [note] }));

    const NOTE_FG_TRUECOLOR = "\x1b[38;2;210;168;255m";
    expect(lines[2]).toContain(NOTE_FG_TRUECOLOR);
  });

  test("an annotated span carries the selection background", () => {
    const note = makeNote({ rowIndex: 0, pane: "right", startColumn: 0, endColumn: 4 });
    const { lines } = paintSplit(paintOptions({ notes: [note] }));

    const SELECTION_BG_TRUECOLOR = "\x1b[48;2;22;50;79m";
    expect(lines[2]).toContain(SELECTION_BG_TRUECOLOR);
  });

  test("every panel row's ScreenRow is chrome", () => {
    const notes = [makeNote()];
    const { map } = paintSplit(paintOptions({ notes }));

    const height = panelHeight(notes.length, "browse", "panel");
    const panelRows = map.rows.slice(-1 - height, -1);

    expect(panelRows).toHaveLength(height);
    expect(panelRows.every((row) => row.kind === "chrome" && row.index === null)).toBe(true);
  });

  test("resolveClick on a panel row returns null", () => {
    const { map } = paintSplit(paintOptions({ notes: [makeNote()] }));

    const panelTerminalRow = map.rows.length - 1;
    const target = resolveClick(map, panelTerminalRow, 5);

    expect(target).toBeNull();
  });

  test("bodyHeight shrinks when notes exist", () => {
    const withoutNotes = bodyHeight(24, 0, "browse", "panel");
    const withNotes = bodyHeight(24, 3, "browse", "panel");

    expect(withNotes).toBeLessThan(withoutNotes);
  });

  test("the marker column shifts textStart, and resolveClick still lands on the right source column", () => {
    const note = makeNote({ rowIndex: 0, pane: "right", startColumn: 0, endColumn: 1 });
    const { map } = paintSplit(paintOptions({ notes: [note] }));

    const rightPane = map.panes.find((pane) => pane.pane === "right");
    expect(rightPane).toBeDefined();

    const sourceColumn = 0;
    const terminalRow = 3;
    const terminalColumn = (rightPane?.textStart ?? 0) + 1 + sourceColumn;

    const target = resolveClick(map, terminalRow, terminalColumn);

    expect(target).toEqual({ kind: "row", index: 0, pane: "right", column: sourceColumn });
  });
});

function makeFakeIo(): { io: TuiIo; feed: (chunk: string) => void } {
  let handler: ((chunk: string) => void) | null = null;

  const io: TuiIo = {
    onKey(nextHandler) {
      handler = nextHandler;
    },
    write() {},
    size() {
      return { width: 80, height: 24 };
    },
    cleanup() {},
  };

  return {
    io,
    feed(chunk: string) {
      handler?.(chunk);
    },
  };
}

function makeOptions(overrides: Partial<TuiOptions> = {}): TuiOptions {
  return {
    before: ["a", "b", "c"],
    after: ["a", "x", "c"],
    path: "file.ts",
    context: 1,
    minFold: 1,
    layout: "split",
    rowBand: false,
    width: 80,
    height: 24,
    truecolor: false,
    resultFile: tempPath(),
    notePosition: "panel",
    tokens: () => [],
    ...overrides,
  };
}

describe("runTui — the result file", () => {
  test("a send quit writes the result file, and its content parses to the expected questions", async () => {
    const fake = makeFakeIo();
    const resultFile = tempPath();
    const options = makeOptions({ resultFile });

    const resultPromise = runTui(options, fake.io);

    fake.feed("a");
    fake.feed("why though");
    fake.feed("\r");
    fake.feed("\x13");

    const result = await resultPromise;

    expect(result.quit).toBe("send");

    const parsed = parseNoteResult(readFileSync(resultFile, "utf-8"));

    expect(parsed).toEqual(result.questions);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.text).toBe("why though");

    unlinkSync(resultFile);
  });

  test("a clean quit writes no file", async () => {
    const fake = makeFakeIo();
    const resultFile = tempPath();
    const options = makeOptions({ resultFile });

    const resultPromise = runTui(options, fake.io);

    fake.feed("\x11");

    const result = await resultPromise;

    expect(result.quit).toBe("clean");
    expect(() => readFileSync(resultFile, "utf-8")).toThrow();
  });

  test("a teardown write that throws still leaves the result file written with the note", async () => {
    const box: { handler: ((chunk: string) => void) | null } = { handler: null };

    const throwingIo: TuiIo = {
      onKey(nextHandler) {
        box.handler = nextHandler;
      },
      write(text) {
        if (text === "\x1b[?1049l") {
          throw new Error("teardown write failed");
        }
      },
      size() {
        return { width: 80, height: 24 };
      },
      cleanup() {},
    };

    const resultFile = tempPath();
    const options = makeOptions({ resultFile });

    const resultPromise = runTui(options, throwingIo);

    box.handler?.("a");
    box.handler?.("why though");
    box.handler?.("\r");
    box.handler?.("\x13");

    await expect(resultPromise).rejects.toThrow("teardown write failed");

    expect(existsSync(resultFile)).toBe(true);

    const parsed = parseNoteResult(readFileSync(resultFile, "utf-8"));

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.text).toBe("why though");

    unlinkSync(resultFile);
  });
});
