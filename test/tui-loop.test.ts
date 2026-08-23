import { test, expect, describe } from "vitest";
import { applyKey, bodyHeight, frameDiff, runTui } from "../src/tui/tui";
import { buildModel, visibleRows } from "../src/tui/model";
import type { TuiIo, TuiOptions, TuiState } from "../src/tui/tui.types";
import type { KeyEvent } from "../src/tui/input/input.types";

function makeState(overrides: Partial<TuiState> = {}): TuiState {
  const model = buildModel(
    Array.from({ length: 10 }, (_, index) => `line${index}`),
    Array.from({ length: 10 }, (_, index) => `line${index}`),
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
    ...overrides,
  };
}

function key(name: string, ctrl = false, text = ""): KeyEvent {
  return { name, ctrl, text };
}

describe("applyKey — cursor movement", () => {
  test("j advances the cursor and does not mutate the input state", () => {
    const state = makeState();
    const clone = structuredClone(state);

    const next = applyKey(state, key("j"), 24);

    expect(next.model.cursor).toBe(1);
    expect(state).toEqual(clone);
  });

  test("k at the top clamps", () => {
    const state = makeState();

    const next = applyKey(state, key("k"), 24);

    expect(next.model.cursor).toBe(0);
  });

  test("ctrl d advances by bodyHeight minus one", () => {
    const model = buildModel(
      Array.from({ length: 40 }, (_, index) => `line${index}`),
      Array.from({ length: 40 }, (_, index) => `line${index}`),
      0,
      0,
    );
    const state = makeState({ model });

    const next = applyKey(state, key("d", true), 10);

    expect(next.model.cursor).toBe(bodyHeight(10) - 1);
  });
});

function buildTwoRunModel() {
  const before = [
    "c0",
    "c1",
    "old1",
    "old1b",
    "c2",
    "c3",
    "c4",
    "c5",
    "c6",
    "c7",
    "c8",
    "c9",
    "c10",
    "old2",
    "c11",
    "c12",
  ];
  const after = [
    "c0",
    "c1",
    "new1",
    "new1b",
    "c2",
    "c3",
    "c4",
    "c5",
    "c6",
    "c7",
    "c8",
    "c9",
    "c10",
    "new2",
    "c11",
    "c12",
  ];

  return buildModel(before, after, 1, 2);
}

describe("applyKey — hunk jumps", () => {
  test("n jumps to the next changed row and skips the rest of the current run", () => {
    const model = buildTwoRunModel();
    const visible = visibleRows(model);
    const firstChangedIndex = visible.findIndex(
      (entry) => entry.kind === "row" && model.rows[entry.index]!.kind !== "context",
    );
    const state = makeState({ model: { ...model, cursor: firstChangedIndex } });

    const next = applyKey(state, key("n"), 24);
    const nextEntry = visibleRows(next.model)[next.model.cursor]!;

    expect(nextEntry.kind).toBe("row");
    expect(nextEntry.kind === "row" && model.rows[nextEntry.index]!.kind).not.toBe("context");
    expect(next.model.cursor).toBeGreaterThan(firstChangedIndex + 1);
  });
});

describe("applyKey — folds", () => {
  test("space on a fold row expands it, and visibleRows then grows", () => {
    const model = buildTwoRunModel();
    const visible = visibleRows(model);
    const foldPosition = visible.findIndex((entry) => entry.kind === "fold");

    expect(foldPosition).toBeGreaterThanOrEqual(0);

    const state = makeState({ model: { ...model, cursor: foldPosition } });
    const before = visibleRows(state.model).length;

    const next = applyKey(state, key(" ", false, " "), 24);

    expect(visibleRows(next.model).length).toBeGreaterThan(before);
  });

  test("space on a context row changes nothing", () => {
    const model = buildTwoRunModel();
    const visible = visibleRows(model);
    const contextPosition = visible.findIndex(
      (entry) => entry.kind === "row" && model.rows[entry.index]!.kind === "context",
    );
    const state = makeState({ model: { ...model, cursor: contextPosition } });
    const clone = structuredClone(state);

    const next = applyKey(state, key(" ", false, " "), 24);

    expect(next).toEqual(clone);
  });
});

describe("applyKey — layout and mode", () => {
  test("u swaps the layout both ways", () => {
    const state = makeState({ layout: "split" });

    const toUnified = applyKey(state, key("u"), 24);
    expect(toUnified.layout).toBe("unified");

    const backToSplit = applyKey(toUnified, key("u"), 24);
    expect(backToSplit.layout).toBe("split");
  });

  test("? enters help mode, and j in help mode changes nothing", () => {
    const state = makeState();

    const helpState = applyKey(state, key("?"), 24);
    expect(helpState.mode).toBe("help");

    const afterJ = applyKey(helpState, key("j"), 24);
    expect(afterJ.model.cursor).toBe(helpState.model.cursor);
    expect(afterJ.mode).toBe("help");
  });
});

describe("applyKey — quit", () => {
  test("ctrl s sets quit to send", () => {
    const state = makeState();

    const next = applyKey(state, key("s", true), 24);

    expect(next.quit).toBe("send");
  });

  test("ctrl q sets quit to clean", () => {
    const state = makeState();

    const next = applyKey(state, key("q", true), 24);

    expect(next.quit).toBe("clean");
  });
});

describe("applyKey — scrollTop follows the cursor", () => {
  test("scrollTop advances when the cursor passes the last body row", () => {
    const model = buildModel(
      Array.from({ length: 40 }, (_, index) => `line${index}`),
      Array.from({ length: 40 }, (_, index) => `line${index}`),
      0,
      0,
    );
    let state = makeState({ model });
    const height = 10;
    const rows = bodyHeight(height);

    for (let step = 0; step < rows; step += 1) {
      state = applyKey(state, key("j"), height);
    }

    expect(state.model.cursor).toBe(rows);
    expect(state.scrollTop).toBe(state.model.cursor - rows + 1);
  });

  test("scrollTop retreats when the cursor moves above it", () => {
    const model = buildModel(
      Array.from({ length: 40 }, (_, index) => `line${index}`),
      Array.from({ length: 40 }, (_, index) => `line${index}`),
      0,
      0,
    );
    const state = makeState({ model: { ...model, cursor: 5 }, scrollTop: 5 });

    const next = applyKey(state, key("k"), 24);

    expect(next.scrollTop).toBe(4);
  });
});

describe("frameDiff", () => {
  test("identical arrays return an empty string", () => {
    expect(frameDiff(["a", "b"], ["a", "b"])).toBe("");
  });

  test("writes only the changed row, with the correct 1-based cursor-position sequence", () => {
    const result = frameDiff(["a", "b", "c"], ["a", "x", "c"]);

    expect(result).toBe("\x1b[2;1Hx");
  });

  test("the first frame has an empty previous and writes every row", () => {
    const result = frameDiff([], ["a", "b"]);

    expect(result).toBe("\x1b[1;1Ha\x1b[2;1Hb");
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
    cleanupCalls: () => state.cleanupCalls,
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

describe("runTui", () => {
  test("a fake TuiIo that feeds ctrl q resolves with quit clean and calls cleanup exactly once", async () => {
    const fake = makeFakeIo();

    const resultPromise = runTui(makeOptions(), fake.io);

    fake.feed("\x11");

    const result = await resultPromise;

    expect(result).toEqual({ quit: "clean", questions: [] });
    expect(fake.cleanupCalls()).toBe(1);
  });

  test("writes the alternate-screen enter sequence first and the leave sequence last", async () => {
    const fake = makeFakeIo();

    const resultPromise = runTui(makeOptions(), fake.io);

    fake.feed("\x11");

    await resultPromise;

    expect(fake.writes[0]).toBe("\x1b[?1049h");
    expect(fake.writes[fake.writes.length - 1]).toBe("\x1b[?1049l");
  });
});
