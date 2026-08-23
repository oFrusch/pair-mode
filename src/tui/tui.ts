import type { Question } from "../core/collect";
import type { KeyEvent, MouseEvent } from "./input/input.types";
import { parseKeys } from "./input/keys";
import { MOUSE_OFF, MOUSE_ON, splitInput } from "./input/mouse";
import { buildModel, moveCursor, resolveClick, toggleFold, visibleRows } from "./model";
import type { ClickTarget, DiffModel, VisibleRow } from "./model";
import type { Span } from "./paint/paint.types";
import { noTokens, paint } from "./paint";
import type { Selection, TuiIo, TuiOptions, TuiResult, TuiState } from "./tui.types";

const HEADER_ROWS = 2;
const STATUS_ROWS = 1;
const OVERLAP_ROWS = 1;
const MIN_PAGE = 1;
const MIN_BODY_HEIGHT = 1;

export function bodyHeight(height: number): number {
  return Math.max(height - HEADER_ROWS - STATUS_ROWS, MIN_BODY_HEIGHT);
}

function pageSize(height: number): number {
  return Math.max(bodyHeight(height) - OVERLAP_ROWS, MIN_PAGE);
}

function followScroll(model: DiffModel, scrollTop: number, height: number): number {
  const bodyRows = bodyHeight(height);
  const lastBodyRow = scrollTop + bodyRows - 1;

  if (model.cursor < scrollTop) {
    return model.cursor;
  }

  if (model.cursor > lastBodyRow) {
    return model.cursor - bodyRows + 1;
  }

  return scrollTop;
}

function isChangedEntry(model: DiffModel, entry: VisibleRow): boolean {
  return entry.kind === "row" && model.rows[entry.index]!.kind !== "context";
}

function jumpToRun(model: DiffModel, direction: 1 | -1): DiffModel {
  const visible = visibleRows(model);

  if (visible.length === 0) {
    return model;
  }

  let index = model.cursor;

  const currentEntry = visible[index];

  if (currentEntry !== undefined && isChangedEntry(model, currentEntry)) {
    while (index >= 0 && index < visible.length) {
      const entry = visible[index]!;

      if (!isChangedEntry(model, entry)) {
        break;
      }

      index += direction;
    }
  } else {
    index += direction;
  }

  while (index >= 0 && index < visible.length) {
    const entry = visible[index]!;

    if (isChangedEntry(model, entry)) {
      return { ...model, cursor: index };
    }

    index += direction;
  }

  return model;
}

function toggleFoldAtCursor(model: DiffModel): DiffModel {
  const visible = visibleRows(model);
  const entry = visible[model.cursor];

  if (entry === undefined || entry.kind !== "fold") {
    return model;
  }

  return toggleFold(model, entry.foldIndex);
}

function withScroll(state: TuiState, model: DiffModel, height: number): TuiState {
  return { ...state, model, scrollTop: followScroll(model, state.scrollTop, height) };
}

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

function moveSelectionHead(state: TuiState, delta: number): TuiState {
  const selection = state.selection;

  if (selection === null) {
    return state;
  }

  const visible = visibleRows(state.model);
  const currentIndex = visible.findIndex((entry) => entry.kind === "row" && entry.index === selection.headRow);

  if (currentIndex === -1) {
    return state;
  }

  const nextIndex = Math.min(Math.max(currentIndex + delta, 0), Math.max(visible.length - 1, 0));
  const entry = visible[nextIndex];
  const headRow = entry !== undefined && entry.kind === "row" ? entry.index : selection.headRow;

  return { ...state, selection: { ...selection, headRow } };
}

function startSelection(state: TuiState): TuiState {
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

export function selectionSpanFor(selection: Selection | null, rowIndex: number, lineLength: number): Span | null {
  if (selection === null) {
    return null;
  }

  const normalized = normalizeSelection(selection);

  if (rowIndex < normalized.anchorRow || rowIndex > normalized.headRow) {
    return null;
  }

  if (normalized.anchorRow === normalized.headRow) {
    return clampSpan({ start: normalized.anchorColumn, end: normalized.headColumn + 1 }, lineLength);
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
  const isPlainClick = normalized.anchorRow === normalized.headRow && normalized.anchorColumn === normalized.headColumn;

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

export function applyKey(state: TuiState, key: KeyEvent, height: number): TuiState {
  if (state.mode === "help") {
    if (!key.ctrl && key.name === "?") {
      return { ...state, mode: "browse" };
    }

    if (key.ctrl && key.name === "s") {
      return { ...state, quit: "send" };
    }

    if (key.ctrl && (key.name === "q" || key.name === "c")) {
      return { ...state, quit: "clean" };
    }

    return state;
  }

  if (key.ctrl) {
    if (key.name === "d") {
      return withScroll(state, moveCursor(state.model, pageSize(height)), height);
    }

    if (key.name === "u") {
      return withScroll(state, moveCursor(state.model, -pageSize(height)), height);
    }

    if (key.name === "s") {
      return { ...state, quit: "send" };
    }

    if (key.name === "q" || key.name === "c") {
      return { ...state, quit: "clean" };
    }

    return state;
  }

  if (key.name === "v") {
    return startSelection(state);
  }

  if (key.name === "escape") {
    return { ...state, selection: null, mode: "browse" };
  }

  if (state.mode === "select") {
    if (key.name === "j" || key.name === "down") {
      return moveSelectionHead(state, 1);
    }

    if (key.name === "k" || key.name === "up") {
      return moveSelectionHead(state, -1);
    }
  }

  if (key.name === "j" || key.name === "down") {
    return withScroll(state, moveCursor(state.model, 1), height);
  }

  if (key.name === "k" || key.name === "up") {
    return withScroll(state, moveCursor(state.model, -1), height);
  }

  if (key.name === "n") {
    return withScroll(state, jumpToRun(state.model, 1), height);
  }

  if (key.name === "N") {
    return withScroll(state, jumpToRun(state.model, -1), height);
  }

  if (key.name === " ") {
    return withScroll(state, toggleFoldAtCursor(state.model), height);
  }

  if (key.name === "u") {
    return { ...state, layout: state.layout === "split" ? "unified" : "split" };
  }

  if (key.name === "?") {
    return { ...state, mode: "help" };
  }

  return state;
}

export function frameDiff(previous: string[], next: string[]): string {
  return next
    .map((line, index) => (line === previous[index] ? "" : `\x1b[${index + 1};1H${line}`))
    .join("");
}

const ENTER_ALT_SCREEN = "\x1b[?1049h";
const LEAVE_ALT_SCREEN = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

export function runTui(options: TuiOptions, io: TuiIo): Promise<TuiResult> {
  return new Promise((resolve, reject) => {
    const model = buildModel(options.before, options.after, options.context, options.minFold);

    let state: TuiState = {
      model,
      mode: "browse",
      scrollTop: 0,
      map: { rows: [], panes: [] },
      layout: options.layout,
      quit: "none",
      selection: null,
    };

    let previousLines: string[] = [];
    let finished = false;

    const repaint = () => {
      const result = paint({
        model: state.model,
        width: options.width,
        height: options.height,
        path: options.path,
        tokens: noTokens,
        truecolor: options.truecolor,
        rowBand: options.rowBand,
        scrollTop: state.scrollTop,
        layout: state.layout,
        selection: state.selection,
      });

      state = { ...state, map: result.map };
      io.write(frameDiff(previousLines, result.lines));
      previousLines = result.lines;
    };

    const attemptTeardown = (): Error | null => {
      let teardownError: Error | null = null;

      try {
        io.write(SHOW_CURSOR);
        io.write(MOUSE_OFF);
        io.write(LEAVE_ALT_SCREEN);
      } catch (writeError) {
        teardownError = writeError instanceof Error ? writeError : new Error(String(writeError));
      }

      try {
        io.cleanup();
      } catch (cleanupError) {
        teardownError = teardownError ?? (cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)));
      }

      return teardownError;
    };

    const finishQuit = (quit: "clean" | "send") => {
      finished = true;

      const teardownError = attemptTeardown();

      if (teardownError !== null) {
        reject(teardownError);
        return;
      }

      const questions: Question[] = [];

      resolve({ quit, questions });
    };

    const finishError = (error: unknown) => {
      if (finished) {
        return;
      }

      finished = true;
      attemptTeardown();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    try {
      io.write(ENTER_ALT_SCREEN);
      io.write(MOUSE_ON);
      io.write(HIDE_CURSOR);
      repaint();
    } catch (error) {
      finishError(error);
      return;
    }

    io.onKey((chunk: string) => {
      if (finished) {
        return;
      }

      try {
        const { keys, mouse } = splitInput(chunk);

        state = mouse.reduce((current, event) => applyMouse(current, event), state);

        const events = parseKeys(keys);

        state = events.reduce((current, event) => applyKey(current, event, options.height), state);

        repaint();

        if (state.quit !== "none") {
          finishQuit(state.quit);
        }
      } catch (error) {
        finishError(error);
      }
    });
  });
}
