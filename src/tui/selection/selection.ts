import type { MouseEvent } from "../input/input.types";
import { resolveClick, toggleFold, visibleRows } from "../model";
import type { ClickTarget, DiffModel } from "../model";
import type { Span } from "../paint/paint.types";
import type { TuiState } from "../tui.types";
import type { Selection } from "./selection.types";

function visibleIndexForRow(model: DiffModel, rowIndex: number): number {
  const visible = visibleRows(model);
  const found = visible.findIndex((entry) => entry.kind === "row" && entry.index === rowIndex);

  return found === -1 ? model.cursor : found;
}

function currentRowIndex(model: DiffModel): number | null {
  const visible = visibleRows(model);
  const entry = visible[model.cursor];

  return entry !== undefined && entry.kind === "row" ? entry.index : null;
}

export function cursorRowIndex(model: DiffModel): number | null {
  return currentRowIndex(model);
}

export function wholeRowSelection(
  model: DiffModel,
  rowIndex: number,
  pane: "left" | "right",
): Selection {
  const length = paneLineLength(model, rowIndex, pane);

  return {
    pane,
    anchorRow: rowIndex,
    anchorColumn: 0,
    headRow: rowIndex,
    headColumn: Math.max(length - 1, 0),
  };
}

export function moveSelectionHead(state: TuiState, delta: number): TuiState {
  const selection = state.selection;

  if (selection === null) {
    return state;
  }

  const visible = visibleRows(state.model);
  const currentIndex = visible.findIndex(
    (entry) => entry.kind === "row" && entry.index === selection.headRow,
  );

  if (currentIndex === -1) {
    return state;
  }

  const nextIndex = Math.min(Math.max(currentIndex + delta, 0), Math.max(visible.length - 1, 0));
  const entry = visible[nextIndex];
  const headRow = entry !== undefined && entry.kind === "row" ? entry.index : selection.headRow;

  return { ...state, selection: { ...selection, headRow } };
}

export function startSelection(state: TuiState): TuiState {
  const rowIndex = currentRowIndex(state.model);

  if (rowIndex === null) {
    return state;
  }

  const selection: Selection = {
    pane: "right",
    anchorRow: rowIndex,
    anchorColumn: 0,
    headRow: rowIndex,
    headColumn: 0,
  };

  return { ...state, selection, mode: "select" };
}

export function normalizeSelection(selection: Selection): Selection {
  const reversed =
    selection.anchorRow > selection.headRow ||
    (selection.anchorRow === selection.headRow && selection.anchorColumn > selection.headColumn);

  if (!reversed) {
    return selection;
  }

  return {
    pane: selection.pane,
    anchorRow: selection.headRow,
    anchorColumn: selection.headColumn,
    headRow: selection.anchorRow,
    headColumn: selection.anchorColumn,
  };
}

function clampSpan(span: Span, lineLength: number): Span {
  return {
    start: Math.min(Math.max(span.start, 0), lineLength),
    end: Math.min(Math.max(span.end, 0), lineLength),
  };
}

export function selectionSpanFor(
  selection: Selection | null,
  rowIndex: number,
  lineLength: number,
): Span | null {
  if (selection === null) {
    return null;
  }

  const normalized = normalizeSelection(selection);

  if (rowIndex < normalized.anchorRow || rowIndex > normalized.headRow) {
    return null;
  }

  if (normalized.anchorRow === normalized.headRow) {
    return clampSpan(
      { start: normalized.anchorColumn, end: normalized.headColumn + 1 },
      lineLength,
    );
  }

  if (rowIndex === normalized.anchorRow) {
    return clampSpan({ start: normalized.anchorColumn, end: lineLength }, lineLength);
  }

  if (rowIndex === normalized.headRow) {
    return clampSpan({ start: 0, end: normalized.headColumn + 1 }, lineLength);
  }

  return clampSpan({ start: 0, end: lineLength }, lineLength);
}

function paneLineLength(model: DiffModel, rowIndex: number, pane: "left" | "right"): number {
  const row = model.rows[rowIndex];

  if (row === undefined) {
    return 0;
  }

  return pane === "left" ? row.left.length : row.right.length;
}

function applyMouseDown(state: TuiState, target: ClickTarget): TuiState {
  if (target.kind === "fold") {
    return { ...state, model: toggleFold(state.model, target.foldIndex) };
  }

  const selection: Selection = {
    pane: target.pane,
    anchorRow: target.index,
    anchorColumn: target.column,
    headRow: target.index,
    headColumn: target.column,
  };

  const model = { ...state.model, cursor: visibleIndexForRow(state.model, target.index) };

  return { ...state, selection, mode: "select", model };
}

function applyMouseDrag(state: TuiState, target: ClickTarget | null): TuiState {
  const selection = state.selection;

  if (selection === null || target === null || target.kind !== "row") {
    return state;
  }

  const samePane = target.pane === selection.pane;
  const lineLength = paneLineLength(state.model, target.index, selection.pane);
  const headColumn = samePane ? target.column : Math.min(Math.max(target.column, 0), lineLength);

  const nextSelection: Selection = { ...selection, headRow: target.index, headColumn };

  return { ...state, selection: nextSelection };
}

function applyMouseUp(state: TuiState): TuiState {
  const selection = state.selection;

  if (selection === null) {
    return { ...state, mode: "browse" };
  }

  const normalized = normalizeSelection(selection);
  const isPlainClick =
    normalized.anchorRow === normalized.headRow &&
    normalized.anchorColumn === normalized.headColumn;

  return { ...state, selection: isPlainClick ? null : normalized, mode: "browse" };
}

export function applyMouse(state: TuiState, event: MouseEvent): TuiState {
  if (event.shift) {
    return state;
  }

  if (event.kind === "scroll") {
    return state;
  }

  if (event.kind === "down") {
    const target = resolveClick(state.map, event.row, event.column);

    if (target === null) {
      return state;
    }

    return applyMouseDown(state, target);
  }

  if (event.kind === "drag") {
    const target = resolveClick(state.map, event.row, event.column);

    return applyMouseDrag(state, target);
  }

  return applyMouseUp(state);
}
