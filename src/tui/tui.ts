import type { Question } from "../core/collect";
import type { KeyEvent, MouseEvent } from "./input/input.types";
import { parseKeys } from "./input/keys";
import { MOUSE_OFF, MOUSE_ON, splitInput } from "./input/mouse";
import { buildModel, moveCursor, toggleFold, visibleRows } from "./model";
import type { DiffModel, VisibleRow } from "./model";
import { noteFromSelection, sortNotes, toQuestions, writeResult } from "./notes";
import { bodyHeight, paint } from "./paint";
import { followScrollTop, maxScrollTop, pageRowStep } from "./paint/layout";
import type { ScrollGeometry } from "./paint/paint.types";
import {
  applyMouse,
  cursorRowIndex,
  moveSelectionHead,
  startSelection,
  wholeRowSelection,
} from "./selection";
import type { TuiIo, TuiOptions, TuiResult, TuiState } from "./tui.types";

const NOTE_PANE = "right";

export { bodyHeight };

// Scroll and cursor arithmetic counts screen lines, so it needs the width that decides the layout too.
function geometryFor(
  state: TuiState,
  model: DiffModel,
  height: number,
  width: number,
): ScrollGeometry {
  return {
    model,
    layout: state.layout,
    width,
    height,
    notes: state.notes,
    mode: state.mode,
    notePosition: state.notePosition,
    selection: state.selection,
  };
}

function pageSize(state: TuiState, height: number, width: number): number {
  return pageRowStep(geometryFor(state, state.model, height, width), state.scrollTop);
}

function visibleIndexForRow(model: DiffModel, rowIndex: number): number {
  const visible = visibleRows(model);
  const found = visible.findIndex((entry) => entry.kind === "row" && entry.index === rowIndex);

  return found === -1 ? model.cursor : found;
}

function isChangedEntry(model: DiffModel, entry: VisibleRow): boolean {
  return entry.kind === "row" && model.rows[entry.index]!.kind !== "context";
}

// Every in-bounds index from `from`, walking in `direction`.
function walkFrom(from: number, length: number, direction: 1 | -1): number[] {
  const count = direction === 1 ? length - from : from + 1;

  return Array.from({ length: Math.max(0, count) }, (_, step) => from + step * direction);
}

function jumpToRun(model: DiffModel, direction: 1 | -1): DiffModel {
  const visible = visibleRows(model);

  if (visible.length === 0) {
    return model;
  }

  const walk = walkFrom(model.cursor, visible.length, direction);
  const current = visible[model.cursor];
  const onRun = current !== undefined && isChangedEntry(model, current);

  const runEnd = walk.findIndex((index) => !isChangedEntry(model, visible[index]!));

  // A cursor already inside a run skips the rest of that run before it looks for the next one.
  const rest = onRun ? (runEnd === -1 ? [] : walk.slice(runEnd)) : walk.slice(1);
  const target = rest.find((index) => isChangedEntry(model, visible[index]!));

  return target === undefined ? model : { ...model, cursor: target };
}

function toggleFoldAtCursor(model: DiffModel): DiffModel {
  const visible = visibleRows(model);
  const entry = visible[model.cursor];

  if (entry === undefined || entry.kind !== "fold") {
    return model;
  }

  return toggleFold(model, entry.foldIndex);
}

const WHEEL_UP_BUTTON = 0;
const WHEEL_DOWN_BUTTON = 1;
const WHEEL_ROWS = 3;

// A trackpad gesture is never perfectly vertical, so it emits horizontal wheel codes throughout.
function wheelStep(button: number): number {
  if (button === WHEEL_UP_BUTTON) {
    return -WHEEL_ROWS;
  }

  return button === WHEEL_DOWN_BUTTON ? WHEEL_ROWS : 0;
}

// The wheel moves the viewport alone. followScrollTop pulls it back to the cursor on the next key.
function applyScroll(state: TuiState, event: MouseEvent, height: number, width: number): TuiState {
  const step = wheelStep(event.button);

  if (step === 0) {
    return state;
  }

  const maxScroll = maxScrollTop(geometryFor(state, state.model, height, width));
  const scrollTop = Math.min(maxScroll, Math.max(0, state.scrollTop + step));

  return scrollTop === state.scrollTop ? state : { ...state, scrollTop };
}

function withScroll(state: TuiState, model: DiffModel, height: number, width: number): TuiState {
  const scrollTop = followScrollTop(geometryFor(state, model, height, width), state.scrollTop);

  return { ...state, model, scrollTop };
}

function commitDraft(state: TuiState): TuiState {
  const cleared: TuiState = { ...state, draft: "", selection: null, mode: "browse" };

  if (state.selection === null) {
    return cleared;
  }

  const note = noteFromSelection(state.model, state.selection, state.nextNoteId, state.draft);

  if (note === null) {
    return cleared;
  }

  return {
    ...cleared,
    notes: sortNotes([...state.notes, note]),
    nextNoteId: state.nextNoteId + 1,
  };
}

function enterNoteMode(state: TuiState): TuiState {
  if (state.selection !== null) {
    return { ...state, mode: "note", draft: "" };
  }

  const rowIndex = cursorRowIndex(state.model);

  if (rowIndex === null) {
    return state;
  }

  return {
    ...state,
    selection: wholeRowSelection(state.model, rowIndex, NOTE_PANE),
    mode: "note",
    draft: "",
  };
}

function focusNextNote(state: TuiState): TuiState {
  if (state.notes.length === 0) {
    return state;
  }

  const ids = state.notes.map((note) => note.id);
  const currentIndex = state.focusedNote === null ? -1 : ids.indexOf(state.focusedNote);
  const nextId = ids[(currentIndex + 1) % ids.length]!;
  const note = state.notes.find((candidate) => candidate.id === nextId)!;
  const model = { ...state.model, cursor: visibleIndexForRow(state.model, note.rowIndex) };

  return { ...state, focusedNote: nextId, model };
}

export function deleteNote(state: TuiState, id: number): TuiState {
  const notes = state.notes.filter((note) => note.id !== id);

  if (state.focusedNote !== id) {
    return { ...state, notes };
  }

  if (notes.length === 0) {
    return { ...state, notes, focusedNote: null };
  }

  const deletedIndex = state.notes.findIndex((note) => note.id === id);
  const nextIndex = Math.min(deletedIndex, notes.length - 1);

  return { ...state, notes, focusedNote: notes[nextIndex]!.id };
}

function deleteFocusedNote(state: TuiState): TuiState {
  return state.focusedNote === null ? state : deleteNote(state, state.focusedNote);
}

function applyConfirmKey(state: TuiState, key: KeyEvent): TuiState {
  if (key.ctrl) {
    return state;
  }

  if (key.name === "s") {
    return { ...state, quit: "send" };
  }

  if (key.name === "d") {
    return { ...state, quit: "clean" };
  }

  if (key.name === "escape") {
    return { ...state, mode: "browse" };
  }

  return state;
}

function applyNoteKey(state: TuiState, key: KeyEvent): TuiState {
  if (key.ctrl) {
    if (key.name === "s") {
      return { ...state, quit: "send" };
    }

    if (key.name === "q" || key.name === "c") {
      return state.notes.length === 0 ? { ...state, quit: "clean" } : { ...state, mode: "confirm" };
    }

    return state;
  }

  if (key.name === "enter") {
    return commitDraft(state);
  }

  if (key.name === "escape") {
    return { ...state, draft: "", mode: "browse" };
  }

  if (key.name === "backspace") {
    return { ...state, draft: state.draft.slice(0, -1) };
  }

  if (key.text !== "") {
    return { ...state, draft: state.draft + key.text };
  }

  return state;
}

export function applyKey(state: TuiState, key: KeyEvent, height: number, width: number): TuiState {
  if (state.mode === "confirm") {
    return applyConfirmKey(state, key);
  }

  if (state.mode === "help") {
    if (!key.ctrl && key.name === "?") {
      return { ...state, mode: "browse" };
    }

    if (key.ctrl && key.name === "s") {
      return { ...state, quit: "send" };
    }

    if (key.ctrl && (key.name === "q" || key.name === "c")) {
      return state.notes.length === 0 ? { ...state, quit: "clean" } : { ...state, mode: "confirm" };
    }

    return state;
  }

  if (state.mode === "note") {
    return applyNoteKey(state, key);
  }

  if (key.ctrl) {
    if (key.name === "d") {
      return withScroll(
        state,
        moveCursor(state.model, pageSize(state, height, width)),
        height,
        width,
      );
    }

    if (key.name === "u") {
      return withScroll(
        state,
        moveCursor(state.model, -pageSize(state, height, width)),
        height,
        width,
      );
    }

    if (key.name === "s") {
      return { ...state, quit: "send" };
    }

    if (key.name === "q" || key.name === "c") {
      return state.notes.length === 0 ? { ...state, quit: "clean" } : { ...state, mode: "confirm" };
    }

    return state;
  }

  // zellij claims ctrl s and ctrl q, so the plain letters are the primary bindings and the ctrl forms are aliases.
  if (key.name === "s") {
    return { ...state, quit: "send" };
  }

  if (key.name === "q") {
    return state.notes.length === 0 ? { ...state, quit: "clean" } : { ...state, mode: "confirm" };
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

  if (key.name === "a") {
    return enterNoteMode(state);
  }

  if (key.name === "tab") {
    return focusNextNote(state);
  }

  if (key.name === "d") {
    return deleteFocusedNote(state);
  }

  if (key.name === "j" || key.name === "down") {
    return withScroll(state, moveCursor(state.model, 1), height, width);
  }

  if (key.name === "k" || key.name === "up") {
    return withScroll(state, moveCursor(state.model, -1), height, width);
  }

  if (key.name === "n") {
    return withScroll(state, jumpToRun(state.model, 1), height, width);
  }

  if (key.name === "N") {
    return withScroll(state, jumpToRun(state.model, -1), height, width);
  }

  if (key.name === " ") {
    return withScroll(state, toggleFoldAtCursor(state.model), height, width);
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

export function runTui(options: TuiOptions, io: TuiIo, abort?: AbortSignal): Promise<TuiResult> {
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
      notes: [],
      focusedNote: null,
      draft: "",
      nextNoteId: 1,
      notePosition: options.notePosition,
    };

    let previousLines: string[] = [];
    let finished = false;

    // The pane can be laid out after the process starts, so every frame reads the live size rather than the startup one.
    const repaint = () => {
      const { width, height } = io.size();

      const result = paint({
        model: state.model,
        width,
        height,
        path: options.path,
        tokens: options.tokens,
        truecolor: options.truecolor,
        rowBand: options.rowBand,
        scrollTop: state.scrollTop,
        layout: state.layout,
        selection: state.selection,
        mode: state.mode,
        draft: state.draft,
        notes: state.notes,
        focusedNote: state.focusedNote,
        notePosition: state.notePosition,
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
        teardownError =
          teardownError ??
          (cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)));
      }

      return teardownError;
    };

    const finishQuit = (quit: "clean" | "send") => {
      finished = true;

      if (quit === "send") {
        writeResult(options.resultFile, state.notes);
      }

      const teardownError = attemptTeardown();

      if (teardownError !== null) {
        reject(teardownError);
        return;
      }

      const questions: Question[] = quit === "send" ? toQuestions(state.notes) : [];

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

    // The hook behind this review died, so the review closes clean and its notes go nowhere.
    abort?.addEventListener(
      "abort",
      () => {
        if (!finished) {
          finishQuit("clean");
        }
      },
      { once: true },
    );

    try {
      io.write(ENTER_ALT_SCREEN);
      io.write(MOUSE_ON);
      io.write(HIDE_CURSOR);
      repaint();
    } catch (error) {
      finishError(error);
      return;
    }

    // A resize invalidates the whole frame, so the diff baseline is cleared before the repaint.
    io.onResize?.(() => {
      if (finished) {
        return;
      }

      try {
        previousLines = [];
        repaint();
      } catch (error) {
        finishError(error);
      }
    });

    io.onKey((chunk: string) => {
      if (finished) {
        return;
      }

      try {
        const { keys, mouse } = splitInput(chunk);

        state = mouse.reduce(
          (current, event) =>
            event.kind === "scroll" && !event.shift
              ? applyScroll(current, event, io.size().height, io.size().width)
              : applyMouse(current, event),
          state,
        );

        const events = parseKeys(keys);

        state = events.reduce(
          (current, event) => applyKey(current, event, io.size().height, io.size().width),
          state,
        );

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
