import type { Question } from "../core/collect";
import type { KeyEvent } from "./input/input.types";
import { parseKeys } from "./input/keys";
import { buildModel, moveCursor, toggleFold, visibleRows } from "./model";
import type { DiffModel, VisibleRow } from "./model";
import { noTokens, paint } from "./paint";
import type { TuiIo, TuiOptions, TuiResult, TuiState } from "./tui.types";

const HEADER_ROWS = 2;
const STATUS_ROWS = 1;
const OVERLAP_ROWS = 1;
const MIN_PAGE = 1;
const MIN_BODY_HEIGHT = 1;

export function bodyHeight(height: number): number {
  return Math.max(height - HEADER_ROWS - STATUS_ROWS, MIN_BODY_HEIGHT);
}

function pageSize(height: number): number {
  return Math.max(height - HEADER_ROWS - STATUS_ROWS - OVERLAP_ROWS, MIN_PAGE);
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
  return new Promise((resolve) => {
    const model = buildModel(options.before, options.after, options.context, options.minFold);

    let state: TuiState = {
      model,
      mode: "browse",
      scrollTop: 0,
      map: { rows: [], panes: [] },
      layout: options.layout,
      quit: "none",
    };

    let previousLines: string[] = [];

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
      });

      state = { ...state, map: result.map };
      io.write(frameDiff(previousLines, result.lines));
      previousLines = result.lines;
    };

    io.write(ENTER_ALT_SCREEN);
    io.write(HIDE_CURSOR);
    repaint();

    io.onKey((chunk: string) => {
      const events = parseKeys(chunk);

      state = events.reduce((current, event) => applyKey(current, event, options.height), state);

      repaint();

      if (state.quit !== "none") {
        io.write(SHOW_CURSOR);
        io.write(LEAVE_ALT_SCREEN);
        io.cleanup();

        const questions: Question[] = [];

        resolve({ quit: state.quit, questions });
      }
    });
  });
}
