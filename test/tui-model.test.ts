import { test, expect, describe } from "vitest";
import {
  buildModel,
  visibleRows,
  toggleFold,
  moveCursor,
  resolveClick,
} from "../src/tui/model";
import type { ScreenMap } from "../src/tui/model";

describe("buildModel — row construction", () => {
  test("an unchanged file produces all context rows and zero folds when minFold exceeds the run length", () => {
    const before = ["a", "b", "c"];
    const after = ["a", "b", "c"];

    const model = buildModel(before, after, 5, 4);

    expect(model.rows.every((row) => row.kind === "context")).toBe(true);
    expect(model.folds).toEqual([]);
  });

  test("a pure insertion produces add rows with leftNumber null", () => {
    const before = ["a"];
    const after = ["a", "b", "c"];

    const model = buildModel(before, after, 5, 4);
    const added = model.rows.filter((row) => row.kind === "add");

    expect(added).toHaveLength(2);
    expect(added.every((row) => row.leftNumber === null)).toBe(true);
    expect(added.map((row) => row.right)).toEqual(["b", "c"]);
  });

  test("a pure deletion produces del rows with rightNumber null", () => {
    const before = ["a", "b", "c"];
    const after = ["a"];

    const model = buildModel(before, after, 5, 4);
    const deleted = model.rows.filter((row) => row.kind === "del");

    expect(deleted).toHaveLength(2);
    expect(deleted.every((row) => row.rightNumber === null)).toBe(true);
    expect(deleted.map((row) => row.left)).toEqual(["b", "c"]);
  });

  test("a one-for-one change produces a replace row with both numbers set", () => {
    const before = ["a", "old", "c"];
    const after = ["a", "new", "c"];

    const model = buildModel(before, after, 5, 4);
    const replaced = model.rows.filter((row) => row.kind === "replace");

    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({ left: "old", right: "new", leftNumber: 2, rightNumber: 2 });
  });

  test("a two-removed-for-one-added change produces one replace row and one del row", () => {
    const before = ["a", "one", "two", "z"];
    const after = ["a", "new", "z"];

    const model = buildModel(before, after, 5, 4);
    const changed = model.rows.filter((row) => row.kind !== "context");

    expect(changed.map((row) => row.kind)).toEqual(["replace", "del"]);
    expect(changed[0]).toMatchObject({ left: "one", right: "new" });
    expect(changed[1]).toMatchObject({ left: "two", right: "" });
  });

  test("a one-removed-for-two-added change produces one replace row and one add row", () => {
    const before = ["a", "one", "z"];
    const after = ["a", "new", "extra", "z"];

    const model = buildModel(before, after, 5, 4);
    const changed = model.rows.filter((row) => row.kind !== "context");

    expect(changed.map((row) => row.kind)).toEqual(["replace", "add"]);
    expect(changed[0]).toMatchObject({ left: "one", right: "new" });
    expect(changed[1]).toMatchObject({ left: "", right: "extra" });
  });

  test("leftNumber and rightNumber diverge correctly after an insertion", () => {
    const before = ["a", "b"];
    const after = ["a", "x", "b"];

    const model = buildModel(before, after, 5, 4);
    const lastRow = model.rows[model.rows.length - 1];

    expect(lastRow).toMatchObject({ leftNumber: 2, rightNumber: 3 });
  });
});

describe("buildModel — folds", () => {
  test("two hunks far apart produce one fold between them", () => {
    const before = ["c0", "c1", "c2", "old", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11", "c12"];
    const after = ["c0", "c1", "c2", "new", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11", "c12"];

    const model = buildModel(before, after, 1, 4);

    expect(model.folds).toHaveLength(1);
  });

  test("a gap shorter than minFold produces no fold", () => {
    const before = ["c0", "old1", "c1", "c2", "old2", "c3"];
    const after = ["c0", "new1", "c1", "c2", "new2", "c3"];

    const model = buildModel(before, after, 0, 4);

    expect(model.folds).toEqual([]);
  });

  test("context rows either side of a change stay visible", () => {
    const before = ["c0", "c1", "c2", "c3", "c4", "old", "c5", "c6", "c7", "c8", "c9", "c10", "c11", "c12"];
    const after = ["c0", "c1", "c2", "c3", "c4", "new", "c5", "c6", "c7", "c8", "c9", "c10", "c11", "c12"];

    const model = buildModel(before, after, 2, 4);
    const visible = visibleRows(model);
    const visibleIndexes = visible.flatMap((entry) => (entry.kind === "row" ? [entry.index] : []));

    for (let offset = 3; offset <= 7; offset += 1) {
      expect(visibleIndexes).toContain(offset);
    }
  });

  test("a file with no change at all produces zero folds and every row visible", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const after = ["a", "b", "c", "d", "e", "f", "g", "h"];

    const model = buildModel(before, after, 1, 2);
    const visible = visibleRows(model);

    expect(model.folds).toEqual([]);
    expect(visible).toHaveLength(before.length);
  });
});

describe("visibility and transitions", () => {
  function twoHunkModel() {
    const before = ["c0", "c1", "c2", "old", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11", "c12"];
    const after = ["c0", "c1", "c2", "new", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11", "c12"];

    return buildModel(before, after, 1, 4);
  }

  test("visibleRows on a collapsed fold returns one fold entry in place of its rows", () => {
    const model = twoHunkModel();
    const visible = visibleRows(model);
    const folds = visible.filter((entry) => entry.kind === "fold");

    expect(folds).toHaveLength(1);
    expect(model.rows.length).toBeGreaterThan(visible.length);
  });

  test("toggleFold expands, and visibleRows then returns the hidden rows", () => {
    const model = twoHunkModel();
    const expanded = toggleFold(model, 0);
    const visible = visibleRows(expanded);

    expect(visible.every((entry) => entry.kind === "row")).toBe(true);
    expect(visible).toHaveLength(model.rows.length);
  });

  test("toggleFold does not mutate the input model", () => {
    const model = twoHunkModel();
    const before = JSON.parse(JSON.stringify(model));

    toggleFold(model, 0);

    expect(model).toEqual(before);
  });

  test("moveCursor clamps at both ends", () => {
    const model = twoHunkModel();

    const movedBelowZero = moveCursor(model, -100);
    expect(movedBelowZero.cursor).toBe(0);

    const visible = visibleRows(model);
    const movedPastEnd = moveCursor(model, 100);
    expect(movedPastEnd.cursor).toBe(visible.length - 1);
  });

  test("moveCursor does not mutate the input model", () => {
    const model = twoHunkModel();
    const before = JSON.parse(JSON.stringify(model));

    moveCursor(model, 1);

    expect(model).toEqual(before);
  });
});

describe("resolveClick", () => {
  const map: ScreenMap = {
    rows: [
      { kind: "chrome", index: null },
      { kind: "row", index: 0 },
      { kind: "fold", index: 2 },
      { kind: "row", index: 3 },
    ],
    panes: [
      { pane: "left", gutterStart: 0, textStart: 4, textEnd: 10 },
      { pane: "right", gutterStart: 10, textStart: 14, textEnd: 20 },
    ],
  };

  test("a click on a chrome row returns null", () => {
    expect(resolveClick(map, 1, 5)).toBeNull();
  });

  test("a click on a fold row returns the fold target from any column", () => {
    expect(resolveClick(map, 3, 1)).toEqual({ kind: "fold", foldIndex: 2 });
    expect(resolveClick(map, 3, 19)).toEqual({ kind: "fold", foldIndex: 2 });
  });

  test("a click in the left pane returns pane left and the correct source column", () => {
    expect(resolveClick(map, 2, 7)).toEqual({ kind: "row", index: 0, pane: "left", column: 2 });
  });

  test("a click in the right pane returns pane right and the correct source column", () => {
    expect(resolveClick(map, 2, 16)).toEqual({ kind: "row", index: 0, pane: "right", column: 1 });
  });

  test("a click in the gutter returns null", () => {
    expect(resolveClick(map, 2, 2)).toBeNull();
  });

  test("a click past textEnd on the right pane returns null", () => {
    expect(resolveClick(map, 2, 21)).toBeNull();
  });

  test("a click on terminal row 1, column 1 resolves against screen index 0, column 0", () => {
    const chromeAtOrigin: ScreenMap = {
      rows: [{ kind: "row", index: 0 }],
      panes: [{ pane: "left", gutterStart: 0, textStart: 0, textEnd: 5 }],
    };

    expect(resolveClick(chromeAtOrigin, 1, 1)).toEqual({ kind: "row", index: 0, pane: "left", column: 0 });
  });
});
