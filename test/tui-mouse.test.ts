import { describe, expect, test } from "vitest";
import { MOUSE_OFF, MOUSE_ON, parseMouse, splitInput } from "../src/tui/input";
import type { MouseEvent } from "../src/tui/input";
import { buildModel } from "../src/tui/model";
import type { DiffModel, ScreenMap } from "../src/tui/model";
import { noTokens, paintSplit } from "../src/tui/paint";
import { applyKey, applyMouse, runTui, selectionSpanFor } from "../src/tui/tui";
import type { Selection, TuiIo, TuiOptions, TuiState } from "../src/tui/tui.types";
import type { KeyEvent } from "../src/tui/input/input.types";

const PRESS = "\x1b[<0;10;5M";
const RELEASE = "\x1b[<0;10;5m";
const DRAG = "\x1b[<32;10;5M";
const SCROLL = "\x1b[<64;10;5M";
const SHIFT_PRESS = "\x1b[<4;10;5M";

describe("parseMouse", () => {
  test("a press report yields down with the right button, row, and column", () => {
    expect(parseMouse(PRESS)).toEqual([{ kind: "down", button: 0, row: 5, column: 10, shift: false }]);
  });

  test("a release report ending in m yields up", () => {
    expect(parseMouse(RELEASE)).toEqual([{ kind: "up", button: 0, row: 5, column: 10, shift: false }]);
  });

  test("a word with bit 32 yields drag", () => {
    const [event] = parseMouse(DRAG);

    expect(event?.kind).toBe("drag");
  });

  test("a word with bit 64 yields scroll", () => {
    const [event] = parseMouse(SCROLL);

    expect(event?.kind).toBe("scroll");
  });

  test("a word with bit 4 sets shift", () => {
    const [event] = parseMouse(SHIFT_PRESS);

    expect(event?.shift).toBe(true);
  });

  test("row and column come back 1-based and unmodified", () => {
    const [event] = parseMouse("\x1b[<0;42;17M");

    expect(event?.row).toBe(17);
    expect(event?.column).toBe(42);
  });

  test("a chunk holding two reports yields two events in order", () => {
    const events = parseMouse(PRESS + RELEASE);

    expect(events).toEqual([
      { kind: "down", button: 0, row: 5, column: 10, shift: false },
      { kind: "up", button: 0, row: 5, column: 10, shift: false },
    ]);
  });
});

describe("splitInput", () => {
  test("a chunk of pure text returns that text and no mouse events", () => {
    expect(splitInput("hello")).toEqual({ keys: "hello", mouse: [] });
  });

  test("a chunk of one mouse report returns an empty key string and one event", () => {
    const result = splitInput(PRESS);

    expect(result.keys).toBe("");
    expect(result.mouse).toHaveLength(1);
  });

  test("a keystroke, then a mouse report, then another keystroke returns both keystrokes concatenated and one event", () => {
    const result = splitInput("j" + PRESS + "k");

    expect(result.keys).toBe("jk");
    expect(result.mouse).toHaveLength(1);
  });
});

function selection(overrides: Partial<Selection> = {}): Selection {
  return { pane: "right", anchorRow: 1, anchorColumn: 2, headRow: 1, headColumn: 2, ...overrides };
}

describe("selectionSpanFor", () => {
  test("a row before the selection returns null", () => {
    expect(selectionSpanFor(selection({ anchorRow: 2, headRow: 4 }), 1, 10)).toBeNull();
  });

  test("a row after it returns null", () => {
    expect(selectionSpanFor(selection({ anchorRow: 2, headRow: 4 }), 5, 10)).toBeNull();
  });

  test("a single-row selection returns the anchor-to-head range, inclusive of the head column", () => {
    expect(selectionSpanFor(selection({ anchorRow: 3, anchorColumn: 2, headRow: 3, headColumn: 5 }), 3, 10)).toEqual({
      start: 2,
      end: 6,
    });
  });

  test("the first row of a multi-row selection runs to the line end", () => {
    expect(
      selectionSpanFor(selection({ anchorRow: 3, anchorColumn: 2, headRow: 5, headColumn: 1 }), 3, 10),
    ).toEqual({ start: 2, end: 10 });
  });

  test("the last row runs from column 0", () => {
    expect(
      selectionSpanFor(selection({ anchorRow: 3, anchorColumn: 2, headRow: 5, headColumn: 1 }), 5, 10),
    ).toEqual({ start: 0, end: 2 });
  });

  test("a middle row covers the whole line", () => {
    expect(
      selectionSpanFor(selection({ anchorRow: 3, anchorColumn: 2, headRow: 5, headColumn: 1 }), 4, 10),
    ).toEqual({ start: 0, end: 10 });
  });

  test("a span clamps to lineLength", () => {
    expect(selectionSpanFor(selection({ anchorRow: 3, anchorColumn: 2, headRow: 3, headColumn: 20 }), 3, 5)).toEqual({
      start: 2,
      end: 5,
    });
  });
});

function buildMouseModel(): DiffModel {
  return {
    rows: [
      { kind: "context", left: "c0", right: "c0", leftNumber: 1, rightNumber: 1 },
      { kind: "add", left: "", right: "added text", leftNumber: null, rightNumber: 2 },
      { kind: "context", left: "c1", right: "c1", leftNumber: 3, rightNumber: 3 },
    ],
    folds: [{ start: 0, count: 1, expanded: false }],
    cursor: 0,
  };
}

function buildMouseMap(): ScreenMap {
  return {
    rows: [
      { kind: "chrome", index: null },
      { kind: "fold", index: 0 },
      { kind: "row", index: 1 },
      { kind: "row", index: 2 },
      { kind: "chrome", index: null },
    ],
    panes: [
      { pane: "left", gutterStart: 0, textStart: 3, textEnd: 13 },
      { pane: "right", gutterStart: 14, textStart: 17, textEnd: 27 },
    ],
  };
}

function buildMouseState(overrides: Partial<TuiState> = {}): TuiState {
  return {
    model: buildMouseModel(),
    mode: "browse",
    scrollTop: 0,
    map: buildMouseMap(),
    layout: "split",
    quit: "none",
    selection: null,
    ...overrides,
  };
}

function mouseEvent(overrides: Partial<MouseEvent> = {}): MouseEvent {
  return { kind: "down", button: 0, row: 1, column: 1, shift: false, ...overrides };
}

describe("applyMouse", () => {
  test("a shift-modified event returns the identical state", () => {
    const state = buildMouseState();
    const clone = structuredClone(state);

    const next = applyMouse(state, mouseEvent({ kind: "down", shift: true, row: 3, column: 20 }));

    expect(next).toEqual(clone);
  });

  test("a scroll event returns the identical state", () => {
    const state = buildMouseState();
    const clone = structuredClone(state);

    const next = applyMouse(state, mouseEvent({ kind: "scroll" }));

    expect(next).toEqual(clone);
  });

  test("a press on a fold row toggles that fold", () => {
    const state = buildMouseState();

    const next = applyMouse(state, mouseEvent({ kind: "down", row: 2, column: 5 }));

    expect(next.model.folds[0]?.expanded).toBe(true);
  });

  test("a press on a chrome row changes nothing", () => {
    const state = buildMouseState();
    const clone = structuredClone(state);

    const next = applyMouse(state, mouseEvent({ kind: "down", row: 1, column: 5 }));

    expect(next).toEqual(clone);
  });

  test("a press on a text row sets the selection and enters select mode", () => {
    const state = buildMouseState();

    const next = applyMouse(state, mouseEvent({ kind: "down", row: 3, column: 20 }));

    expect(next.selection).toEqual({ pane: "right", anchorRow: 1, anchorColumn: 2, headRow: 1, headColumn: 2 });
    expect(next.mode).toBe("select");
  });

  test("a drag with no selection changes nothing", () => {
    const state = buildMouseState();
    const clone = structuredClone(state);

    const next = applyMouse(state, mouseEvent({ kind: "drag", row: 4, column: 19 }));

    expect(next).toEqual(clone);
  });

  test("a drag after a press moves the head and keeps the anchor", () => {
    const pressed = applyMouse(buildMouseState(), mouseEvent({ kind: "down", row: 3, column: 20 }));

    const next = applyMouse(pressed, mouseEvent({ kind: "drag", row: 4, column: 19 }));

    expect(next.selection).toEqual({ pane: "right", anchorRow: 1, anchorColumn: 2, headRow: 2, headColumn: 1 });
  });

  test("a drag into the other pane keeps the anchor's pane", () => {
    const pressed = applyMouse(buildMouseState(), mouseEvent({ kind: "down", row: 3, column: 20 }));

    const next = applyMouse(pressed, mouseEvent({ kind: "drag", row: 4, column: 12 }));

    expect(next.selection?.pane).toBe("right");
    expect(next.selection?.headColumn).toBe(2);
  });

  test("a release with anchor equal to head clears the selection", () => {
    const pressed = applyMouse(buildMouseState(), mouseEvent({ kind: "down", row: 3, column: 20 }));

    const next = applyMouse(pressed, mouseEvent({ kind: "up", row: 3, column: 20 }));

    expect(next.selection).toBeNull();
    expect(next.mode).toBe("browse");
  });

  test("a release after a real drag normalises a backwards selection and returns to browse", () => {
    const backwards = buildMouseState({
      mode: "select",
      selection: { pane: "right", anchorRow: 2, anchorColumn: 1, headRow: 1, headColumn: 2 },
    });

    const next = applyMouse(backwards, mouseEvent({ kind: "up", row: 3, column: 20 }));

    expect(next.selection).toEqual({ pane: "right", anchorRow: 1, anchorColumn: 2, headRow: 2, headColumn: 1 });
    expect(next.mode).toBe("browse");
  });

  test("no function in this file mutates its input state", () => {
    const state = buildMouseState();
    const clone = structuredClone(state);

    applyMouse(state, mouseEvent({ kind: "down", row: 3, column: 20 }));

    expect(state).toEqual(clone);
  });
});

function key(name: string, ctrl = false, text = ""): KeyEvent {
  return { name, ctrl, text };
}

function buildKeyState(overrides: Partial<TuiState> = {}): TuiState {
  const model = buildModel(
    Array.from({ length: 5 }, (_, index) => `line${index}`),
    Array.from({ length: 5 }, (_, index) => `line${index}`),
    0,
    0,
  );

  return {
    model,
    mode: "browse",
    scrollTop: 0,
    map: { rows: [], panes: [] },
    layout: "split",
    quit: "none",
    selection: null,
    ...overrides,
  };
}

describe("applyKey — selection", () => {
  test("v starts a selection at the cursor", () => {
    const state = buildKeyState({ model: { ...buildKeyState().model, cursor: 2 } });

    const next = applyKey(state, key("v"), 24);

    expect(next.selection).toEqual({ pane: "right", anchorRow: 2, anchorColumn: 0, headRow: 2, headColumn: 0 });
    expect(next.mode).toBe("select");
  });

  test("escape clears it", () => {
    const state = buildKeyState({
      mode: "select",
      selection: { pane: "right", anchorRow: 1, anchorColumn: 0, headRow: 1, headColumn: 0 },
    });

    const next = applyKey(state, key("escape"), 24);

    expect(next.selection).toBeNull();
    expect(next.mode).toBe("browse");
  });

  test("j in select mode moves the head, not the cursor", () => {
    const state = buildKeyState({
      mode: "select",
      selection: { pane: "right", anchorRow: 0, anchorColumn: 0, headRow: 0, headColumn: 0 },
    });
    const originalCursor = state.model.cursor;

    const next = applyKey(state, key("j"), 24);

    expect(next.selection?.headRow).toBe(1);
    expect(next.model.cursor).toBe(originalCursor);
  });
});

function makeFakeIo() {
  let handler: ((chunk: string) => void) | null = null;
  const writes: string[] = [];
  const state = { cleanupCalls: 0 };

  const io: TuiIo = {
    onKey(nextHandler) {
      handler = nextHandler;
    },
    write(text) {
      writes.push(text);
    },
    size() {
      return { width: 80, height: 24 };
    },
    cleanup() {
      state.cleanupCalls += 1;
    },
  };

  return {
    io,
    writes,
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
    ...overrides,
  };
}

describe("runTui — mouse reporting", () => {
  test("writes MOUSE_ON after the alternate-screen enter sequence", async () => {
    const fake = makeFakeIo();

    const resultPromise = runTui(makeOptions(), fake.io);
    fake.feed("\x11");
    await resultPromise;

    const enterIndex = fake.writes.indexOf("\x1b[?1049h");
    const mouseOnIndex = fake.writes.indexOf(MOUSE_ON);

    expect(enterIndex).toBeGreaterThanOrEqual(0);
    expect(mouseOnIndex).toBe(enterIndex + 1);
  });

  test("writes MOUSE_OFF before the alternate-screen leave sequence", async () => {
    const fake = makeFakeIo();

    const resultPromise = runTui(makeOptions(), fake.io);
    fake.feed("\x11");
    await resultPromise;

    const leaveIndex = fake.writes.indexOf("\x1b[?1049l");
    const mouseOffIndex = fake.writes.indexOf(MOUSE_OFF);

    expect(mouseOffIndex).toBeGreaterThanOrEqual(0);
    expect(mouseOffIndex).toBeLessThan(leaveIndex);
  });
});

const SELECTION_BG_TRUECOLOR = "\x1b[48;2;22;50;79m";

function buildPaintModel(): DiffModel {
  return {
    rows: [
      { kind: "context", left: "aaaa", right: "aaaa", leftNumber: 1, rightNumber: 1 },
      { kind: "context", left: "bbbb", right: "bbbb", leftNumber: 2, rightNumber: 2 },
    ],
    folds: [],
    cursor: 0,
  };
}

describe("paintSplit — selection layer", () => {
  test("a painted row covered by a selection carries the selection background code", () => {
    const paintSelection: Selection = { pane: "right", anchorRow: 0, anchorColumn: 0, headRow: 0, headColumn: 1 };

    const { lines } = paintSplit({
      model: buildPaintModel(),
      width: 40,
      height: 6,
      path: "f.ts",
      tokens: noTokens,
      truecolor: true,
      rowBand: false,
      scrollTop: 0,
      layout: "split",
      selection: paintSelection,
    });

    expect(lines[2]).toContain(SELECTION_BG_TRUECOLOR);
  });

  test("a painted row outside the selection does not carry the selection background code", () => {
    const paintSelection: Selection = { pane: "right", anchorRow: 0, anchorColumn: 0, headRow: 0, headColumn: 1 };

    const { lines } = paintSplit({
      model: buildPaintModel(),
      width: 40,
      height: 6,
      path: "f.ts",
      tokens: noTokens,
      truecolor: true,
      rowBand: false,
      scrollTop: 0,
      layout: "split",
      selection: paintSelection,
    });

    expect(lines[3]).not.toContain(SELECTION_BG_TRUECOLOR);
  });
});
