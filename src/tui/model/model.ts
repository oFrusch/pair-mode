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

function buildRows(before: string[], after: string[]): ModelRow[] {
  const rows: ModelRow[] = [];
  let leftCounter = 0;
  let rightCounter = 0;

  for (const opcode of opcodes(before, after)) {
    const removed = before.slice(opcode.i1, opcode.i2);
    const added = after.slice(opcode.j1, opcode.j2);
    const rowCount = Math.max(removed.length, added.length);

    for (let row = 0; row < rowCount; row += 1) {
      const removedLine = removed[row];
      const addedLine = added[row];

      const left = removedLine === undefined ? "" : removedLine;
      const right = addedLine === undefined ? "" : addedLine;

      const leftNumber = removedLine === undefined ? null : (leftCounter += 1);
      const rightNumber = addedLine === undefined ? null : (rightCounter += 1);

      const kind: RowKind =
        opcode.tag === "equal"
          ? "context"
          : removedLine !== undefined && addedLine !== undefined
            ? "replace"
            : removedLine !== undefined
              ? "del"
              : "add";

      rows.push({ kind, left, right, leftNumber, rightNumber });
    }
  }

  return rows;
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

  const folds: FoldGroup[] = [];
  let index = 0;

  while (index < rows.length) {
    if (keep[index]) {
      index += 1;
      continue;
    }

    const start = index;

    while (index < rows.length && !keep[index]) {
      index += 1;
    }

    const span = index - start;

    if (span >= minFold) {
      folds.push({ start, count: span, expanded: false });
    }
  }

  return folds;
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

export function visibleRows(model: DiffModel): VisibleRow[] {
  const foldByStart = new Map(model.folds.map((foldGroup, foldIndex) => [foldGroup.start, foldIndex]));
  const result: VisibleRow[] = [];
  let index = 0;

  while (index < model.rows.length) {
    const foldIndex = foldByStart.get(index);
    const foldGroup = foldIndex === undefined ? undefined : model.folds[foldIndex];

    if (foldGroup !== undefined && foldIndex !== undefined && !foldGroup.expanded) {
      result.push({ kind: "fold", foldIndex });
      index += foldGroup.count;
      continue;
    }

    result.push({ kind: "row", index });
    index += 1;
  }

  return result;
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

  return { kind: "row", index: screenRow.index, pane: bounds.pane, column: column - bounds.textStart };
}
