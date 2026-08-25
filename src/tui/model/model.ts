import { opcodes } from "../../core/diff";
import type {
  ClickTarget,
  DiffModel,
  FoldGroup,
  ModelRow,
  RowKind,
  ScreenMap,
  VisibleRow,
} from "./model.types";

const TAB_WIDTH = 8;
const CONTROL_BYTE_CEILING = 0x20;
const CONTROL_BYTE_PLACEHOLDER = "?";

// Runs once when the model is built, so the painter and resolveClick always agree on the same sanitised string and its column math.
function sanitizeLine(text: string): string {
  // Split by code unit, not by code point, so a surrogate pair keeps its two columns of tab math.
  const scan = text.split("").reduce(
    (state, char) => {
      if (char === "\t") {
        const width = TAB_WIDTH - (state.column % TAB_WIDTH);

        return { output: state.output + " ".repeat(width), column: state.column + width };
      }

      if (char.charCodeAt(0) < CONTROL_BYTE_CEILING) {
        return {
          output: state.output + CONTROL_BYTE_PLACEHOLDER,
          column: state.column + 1,
        };
      }

      return { output: state.output + char, column: state.column + 1 };
    },
    { output: "", column: 0 },
  );

  return scan.output;
}

function buildRows(before: string[], after: string[]): ModelRow[] {
  return opcodes(before, after).flatMap((opcode) => {
    const removed = before.slice(opcode.i1, opcode.i2);
    const added = after.slice(opcode.j1, opcode.j2);
    const rowCount = Math.max(removed.length, added.length);

    return Array.from({ length: rowCount }, (_, row): ModelRow => {
      const removedLine = removed[row];
      const addedLine = added[row];

      const left = removedLine === undefined ? "" : sanitizeLine(removedLine);
      const right = addedLine === undefined ? "" : sanitizeLine(addedLine);

      // Opcodes cover both sides contiguously, so the opcode offset plus the row is the running count.
      const leftNumber = removedLine === undefined ? null : opcode.i1 + row + 1;
      const rightNumber = addedLine === undefined ? null : opcode.j1 + row + 1;

      const kind: RowKind =
        opcode.tag === "equal"
          ? "context"
          : removedLine !== undefined && addedLine !== undefined
            ? "replace"
            : removedLine !== undefined
              ? "del"
              : "add";

      return { kind, left, right, leftNumber, rightNumber };
    });
  });
}

function buildFolds(rows: ModelRow[], context: number, minFold: number): FoldGroup[] {
  const keep = Array.from<boolean>({ length: rows.length }).fill(false);

  rows.forEach((row, index) => {
    if (row.kind === "context") {
      return;
    }

    const start = Math.max(0, index - context);
    const end = Math.min(rows.length, index + context + 1);

    keep.fill(true, start, end);
  });

  if (!keep.some((value) => value)) {
    return [];
  }

  // A run of hidden rows opens where the row is dropped and the row before it is kept.
  const runStarts = keep.flatMap((kept, index) =>
    kept || (index > 0 && keep[index - 1] === false) ? [] : [index],
  );

  return runStarts
    .map((start): FoldGroup => {
      const nextKept = keep.indexOf(true, start);
      const end = nextKept === -1 ? rows.length : nextKept;

      return { start, count: end - start, expanded: false };
    })
    .filter((fold) => fold.count >= minFold);
}

export function buildModel(
  before: string[],
  after: string[],
  context: number,
  minFold: number,
): DiffModel {
  const rows = buildRows(before, after);
  const folds = buildFolds(rows, context, minFold);

  return { rows, folds, cursor: 0 };
}

function computeVisibleRows(model: DiffModel): VisibleRow[] {
  const foldByStart = new Map(
    model.folds.map((foldGroup, foldIndex) => [foldGroup.start, foldIndex]),
  );
  // A collapsed fold swallows every row it covers, and the fold marker stands in for the first of them.
  const hidden = new Set(
    model.folds.flatMap((foldGroup) =>
      foldGroup.expanded
        ? []
        : Array.from({ length: foldGroup.count }, (_, offset) => foldGroup.start + offset),
    ),
  );

  return model.rows.flatMap((_, index): VisibleRow[] => {
    const foldIndex = foldByStart.get(index);
    const foldGroup = foldIndex === undefined ? undefined : model.folds[foldIndex];

    if (foldGroup !== undefined && foldIndex !== undefined && !foldGroup.expanded) {
      return [{ kind: "fold", foldIndex }];
    }

    return hidden.has(index) ? [] : [{ kind: "row", index }];
  });
}

// A cursor move clones the model every keypress, so the cache keys on the two arrays the result really depends on.
const visibleRowsCache = new WeakMap<ModelRow[], WeakMap<FoldGroup[], VisibleRow[]>>();

export function visibleRows(model: DiffModel): VisibleRow[] {
  const byFolds = visibleRowsCache.get(model.rows) ?? new WeakMap<FoldGroup[], VisibleRow[]>();
  const cached = byFolds.get(model.folds);

  if (cached !== undefined) {
    return cached;
  }

  const computed = computeVisibleRows(model);

  byFolds.set(model.folds, computed);
  visibleRowsCache.set(model.rows, byFolds);

  return computed;
}

export function toggleFold(model: DiffModel, foldIndex: number): DiffModel {
  if (foldIndex < 0 || foldIndex >= model.folds.length) {
    return model;
  }

  const folds = model.folds.map((foldGroup, index) =>
    index === foldIndex ? { ...foldGroup, expanded: !foldGroup.expanded } : foldGroup,
  );

  return { ...model, folds };
}

export function moveCursor(model: DiffModel, delta: number): DiffModel {
  const visible = visibleRows(model);

  if (visible.length === 0) {
    return { ...model, cursor: 0 };
  }

  const clamped = Math.min(Math.max(model.cursor + delta, 0), visible.length - 1);

  return { ...model, cursor: clamped };
}

export function resolveClick(
  map: ScreenMap,
  terminalRow: number,
  terminalColumn: number,
): ClickTarget | null {
  const row = terminalRow - 1;
  const column = terminalColumn - 1;

  const screenRow = row >= 0 && row < map.rows.length ? map.rows[row] : undefined;

  if (screenRow === undefined || screenRow.kind === "chrome") {
    return null;
  }

  if (screenRow.kind === "fold") {
    return screenRow.index === null ? null : { kind: "fold", foldIndex: screenRow.index };
  }

  if (screenRow.index === null) {
    return null;
  }

  const bounds = map.panes.find((pane) => column >= pane.textStart && column < pane.textEnd);

  if (bounds === undefined) {
    return null;
  }

  return {
    kind: "row",
    index: screenRow.index,
    pane: bounds.pane,
    column: column - bounds.textStart,
  };
}
