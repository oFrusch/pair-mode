import { basename } from "node:path";
import { visibleRows } from "../model/model";
import type { DiffModel, FoldGroup, ModelRow, PaneBounds, RowKind, ScreenMap, ScreenRow, VisibleRow } from "../model/model.types";
import type { Note } from "../notes/notes.types";
import { selectionSpanFor } from "../selection";
import type { Selection } from "../selection/selection.types";
import type { Mode } from "../tui.types";
import { changedSpans, layoutStatusMessage } from "./paint";
import { bg, DEFAULT_BG, DEFAULT_FG, fg, RESET, theme } from "./theme";
import type {
  PaintOptions,
  PaintResult,
  SignBarStyle,
  Span,
  SyntaxToken,
  TokenProvider,
  UnifiedBarStyle,
  UnifiedBodyEntry,
  UnifiedHalfKind,
} from "./paint.types";

const NUMBER_WIDTH_FLOOR = 2;
const GUTTER_SPACE_WIDTH = 1;
const SIGN_BAR_WIDTH = 1;
const DIVIDER_WIDTH = 1;
const PANE_COUNT = 2;
const HEADER_ROWS = 2;
const STATUS_ROWS = 1;
const HEADER_COUNT_GAP_WIDTH = 1;
const UNIFIED_PANE_COUNT = 1;
const TEXT_GAP_WIDTH = 1;
const MIN_BODY_HEIGHT = 1;
const MARKER_WIDTH = 1;
const NOTE_MARKER = "●";
const FOCUSED_NOTE_MARKER = "▸";
const PANEL_TITLE_ROWS = 1;
const PANEL_DRAFT_ROWS = 1;
const PANEL_MAX_HEIGHT = 6;
const CONFIRM_PANEL_HEIGHT = 2;
const CURSOR_WIDTH = 1;

const SIGN_BAR: Record<RowKind, SignBarStyle> = {
  context: { leftChar: " ", leftColor: null, rightChar: " ", rightColor: null },
  add: { leftChar: " ", leftColor: null, rightChar: "▌", rightColor: theme.addBar },
  del: { leftChar: "▌", leftColor: theme.delBar, rightChar: " ", rightColor: null },
  replace: { leftChar: "▌", leftColor: theme.delBar, rightChar: "▌", rightColor: theme.addBar },
};

export function panelHeight(noteCount: number, mode: Mode): number {
  if (mode === "confirm") {
    return CONFIRM_PANEL_HEIGHT;
  }

  const draftRows = mode === "note" ? PANEL_DRAFT_ROWS : 0;
  const rowCount = noteCount + draftRows;

  return rowCount === 0 ? 0 : Math.min(rowCount + PANEL_TITLE_ROWS, PANEL_MAX_HEIGHT);
}

export function bodyHeight(height: number, noteCount: number, mode: Mode): number {
  return Math.max(height - HEADER_ROWS - STATUS_ROWS - panelHeight(noteCount, mode), MIN_BODY_HEIGHT);
}

function hasPaneNotes(notes: Note[], pane: "left" | "right"): boolean {
  return notes.some((note) => note.pane === pane);
}

function noteSpansFor(notes: Note[], rowIndex: number, pane: "left" | "right"): Span[] {
  return notes
    .filter((note) => note.rowIndex === rowIndex && note.pane === pane)
    .map((note) => ({ start: note.startColumn, end: note.endColumn }));
}

function isAnnotatedRow(notes: Note[], rowIndex: number, pane: "left" | "right"): boolean {
  return notes.some((note) => note.rowIndex === rowIndex && note.pane === pane);
}

function paintMarkerColumn(hasColumn: boolean, annotated: boolean, truecolor: boolean): string {
  if (!hasColumn) {
    return "";
  }

  return annotated ? fg(theme.note, truecolor) + NOTE_MARKER + DEFAULT_FG : " ";
}

function computeNumberWidth(model: DiffModel): number {
  const numbers = model.rows
    .flatMap((row) => [row.leftNumber, row.rightNumber])
    .filter((value): value is number => value !== null);

  const maxNumber = numbers.length === 0 ? 0 : Math.max(...numbers);

  return Math.max(NUMBER_WIDTH_FLOOR, String(maxNumber).length);
}

function lookupRow(model: DiffModel, index: number): ModelRow {
  const row = model.rows[index];

  if (row === undefined) {
    throw new Error(`paintSplit: row index out of bounds: ${index}`);
  }

  return row;
}

function lookupFold(model: DiffModel, foldIndex: number): FoldGroup {
  const fold = model.folds[foldIndex];

  if (fold === undefined) {
    throw new Error(`paintSplit: fold index out of bounds: ${foldIndex}`);
  }

  return fold;
}

function paintGutter(lineNumber: number | null, numberWidth: number, truecolor: boolean): string {
  const text = lineNumber === null ? "" : String(lineNumber);

  return fg(theme.fold, truecolor) + text.padStart(numberWidth, " ") + " " + DEFAULT_FG;
}

function paintSignBar(char: string, color: string | null, truecolor: boolean): string {
  return color === null ? DEFAULT_FG + char : fg(color, truecolor) + char;
}

function renderPaneText(
  text: string,
  tokens: SyntaxToken[],
  changeSpansForSide: Span[],
  changeColor: string | null,
  paneWidth: number,
  rowBand: boolean,
  truecolor: boolean,
  highlightSpans: Span[],
): string {
  const textLength = Math.min(text.length, paneWidth);
  let output = "";
  let currentFg: string | null | undefined;
  let currentBg: string | null | undefined;

  for (let column = 0; column < paneWidth; column += 1) {
    const char = column < textLength ? text.charAt(column) : " ";
    const token = column < textLength ? tokens.find((candidate) => column >= candidate.start && column < candidate.end) : undefined;
    const desiredFg = token === undefined ? null : token.color;

    const withinSpan = changeSpansForSide.some((span) => column >= span.start && column < span.end);
    const withinHighlight = highlightSpans.some((span) => column >= span.start && column < span.end);
    const desiredBg = withinHighlight ? theme.selection : changeColor !== null && (rowBand || withinSpan) ? changeColor : null;

    if (desiredFg !== currentFg) {
      output += desiredFg === null ? DEFAULT_FG : fg(desiredFg, truecolor);
      currentFg = desiredFg;
    }

    if (desiredBg !== currentBg) {
      output += desiredBg === null ? DEFAULT_BG : bg(desiredBg, truecolor);
      currentBg = desiredBg;
    }

    output += char;
  }

  return output;
}

function paintModelRow(
  row: ModelRow,
  rowIndex: number,
  leftBounds: PaneBounds,
  rightBounds: PaneBounds,
  numberWidth: number,
  tokens: TokenProvider,
  rowBand: boolean,
  truecolor: boolean,
  selection: Selection | null,
  notes: Note[],
  hasLeftMarkerColumn: boolean,
  hasRightMarkerColumn: boolean,
): string {
  const bar = SIGN_BAR[row.kind];
  const spans = changedSpans(row.left, row.right);

  const leftColor = row.kind === "del" || row.kind === "replace" ? theme.delSpan : null;
  const rightColor = row.kind === "add" || row.kind === "replace" ? theme.addSpan : null;

  const leftPaneWidth = leftBounds.textEnd - leftBounds.textStart;
  const rightPaneWidth = rightBounds.textEnd - rightBounds.textStart;

  const leftSelectionSpan =
    selection !== null && selection.pane === "left" ? selectionSpanFor(selection, rowIndex, row.left.length) : null;
  const rightSelectionSpan =
    selection !== null && selection.pane === "right" ? selectionSpanFor(selection, rowIndex, row.right.length) : null;

  const leftHighlights = [
    ...(leftSelectionSpan === null ? [] : [leftSelectionSpan]),
    ...noteSpansFor(notes, rowIndex, "left"),
  ];
  const rightHighlights = [
    ...(rightSelectionSpan === null ? [] : [rightSelectionSpan]),
    ...noteSpansFor(notes, rowIndex, "right"),
  ];

  const leftText = renderPaneText(
    row.left,
    tokens(row.left, row.leftNumber),
    spans.left,
    leftColor,
    leftPaneWidth,
    rowBand,
    truecolor,
    leftHighlights,
  );

  const rightText = renderPaneText(
    row.right,
    tokens(row.right, row.rightNumber),
    spans.right,
    rightColor,
    rightPaneWidth,
    rowBand,
    truecolor,
    rightHighlights,
  );

  const divider = fg(theme.fold, truecolor) + "│" + DEFAULT_FG;

  return (
    paintGutter(row.leftNumber, numberWidth, truecolor) +
    paintSignBar(bar.leftChar, bar.leftColor, truecolor) +
    paintMarkerColumn(hasLeftMarkerColumn, isAnnotatedRow(notes, rowIndex, "left"), truecolor) +
    leftText +
    divider +
    paintGutter(row.rightNumber, numberWidth, truecolor) +
    paintSignBar(bar.rightChar, bar.rightColor, truecolor) +
    paintMarkerColumn(hasRightMarkerColumn, isAnnotatedRow(notes, rowIndex, "right"), truecolor) +
    rightText +
    RESET
  );
}

function paintFoldRow(fold: FoldGroup, width: number, truecolor: boolean): string {
  const label = `⋯ ${fold.count} unchanged lines`;
  const totalPadding = Math.max(0, width - label.length);
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;

  return fg(theme.fold, truecolor) + " ".repeat(leftPadding) + label + " ".repeat(rightPadding) + RESET;
}

function paintHeader(path: string, addCount: number, delCount: number, width: number, truecolor: boolean): string {
  const prefix = `pair mode│${basename(path)}│`;
  const addText = `+${addCount}`;
  const delText = `-${delCount}`;

  const used = prefix.length + addText.length + HEADER_COUNT_GAP_WIDTH + delText.length;
  const padding = " ".repeat(Math.max(0, width - used));

  return (
    fg(theme.chrome, truecolor) +
    prefix +
    fg(theme.addBar, truecolor) +
    addText +
    fg(theme.chrome, truecolor) +
    " ".repeat(HEADER_COUNT_GAP_WIDTH) +
    fg(theme.delBar, truecolor) +
    delText +
    fg(theme.chrome, truecolor) +
    padding +
    RESET
  );
}

function paintRule(width: number, truecolor: boolean): string {
  return fg(theme.fold, truecolor) + "─".repeat(width) + RESET;
}

function paintStatus(width: number, truecolor: boolean, message: string | null): string {
  const text = message === null ? "" : message.slice(0, width);
  const padding = " ".repeat(Math.max(0, width - text.length));

  return bg(theme.chrome, truecolor) + text + padding + RESET;
}

function paintBlankLine(width: number): string {
  return " ".repeat(width) + RESET;
}

function padPanelLine(content: string, contentLength: number, width: number): string {
  return content + " ".repeat(Math.max(0, width - contentLength)) + RESET;
}

function paintPanelTitle(noteCount: number, width: number, truecolor: boolean): string {
  const text = `NOTES (${noteCount})`.slice(0, width);

  return padPanelLine(fg(theme.note, truecolor) + text + DEFAULT_FG, text.length, width);
}

function noteAnchorLabel(note: Note): string {
  return note.line === null ? "L?" : `L${note.line}`;
}

function paintNoteRow(note: Note, focused: boolean, width: number, truecolor: boolean): string {
  const marker = focused ? FOCUSED_NOTE_MARKER : NOTE_MARKER;
  const rest = ` ${noteAnchorLabel(note)} ${note.text}`.slice(0, Math.max(0, width - MARKER_WIDTH));

  return padPanelLine(fg(theme.note, truecolor) + marker + DEFAULT_FG + rest, marker.length + rest.length, width);
}

function paintDraftRow(draft: string, width: number, truecolor: boolean): string {
  const text = draft.slice(0, Math.max(0, width - CURSOR_WIDTH));
  const cursor = bg(theme.chrome, truecolor) + " " + DEFAULT_BG;

  return padPanelLine(text + cursor, text.length + CURSOR_WIDTH, width);
}

function paintConfirmSummary(noteCount: number, width: number, truecolor: boolean): string {
  const text = `${noteCount} notes are not sent.`.slice(0, width);

  return padPanelLine(fg(theme.chrome, truecolor) + text + DEFAULT_FG, text.length, width);
}

function paintConfirmChoices(width: number, truecolor: boolean): string {
  const choices: Array<[string, string]> = [
    ["s", " send   "],
    ["d", " discard and apply the edit   "],
    ["esc", " back"],
  ];

  const content = choices.map(([key, label]) => bg(theme.chrome, truecolor) + key + DEFAULT_BG + label).join("");
  const plainLength = choices.reduce((sum, [key, label]) => sum + key.length + label.length, 0);

  return padPanelLine(content, plainLength, width);
}

function buildPanel(options: PaintOptions, width: number, truecolor: boolean): UnifiedBodyEntry {
  const { notes, focusedNote, mode, draft } = options;
  const height = panelHeight(notes.length, mode);

  if (height === 0) {
    return { lines: [], screenRows: [] };
  }

  const chromeRow: ScreenRow = { kind: "chrome", index: null };

  if (mode === "confirm") {
    return {
      lines: [paintConfirmSummary(notes.length, width, truecolor), paintConfirmChoices(width, truecolor)],
      screenRows: [chromeRow, chromeRow],
    };
  }

  const draftRows = mode === "note" ? PANEL_DRAFT_ROWS : 0;
  const availableForNotes = Math.max(0, height - PANEL_TITLE_ROWS - draftRows);
  const visibleNotes = notes.slice(0, availableForNotes);

  const lines = [
    paintPanelTitle(notes.length, width, truecolor),
    ...visibleNotes.map((note) => paintNoteRow(note, note.id === focusedNote, width, truecolor)),
    ...(mode === "note" ? [paintDraftRow(draft, width, truecolor)] : []),
  ];

  return { lines, screenRows: lines.map(() => chromeRow) };
}

function assembleScreen(
  header: string,
  rule: string,
  bodyLines: string[],
  bodyScreenRows: ScreenRow[],
  bodyRows: number,
  panelLines: string[],
  panelScreenRows: ScreenRow[],
  statusMessage: string | null,
  width: number,
  height: number,
  truecolor: boolean,
  panes: PaneBounds[],
): PaintResult {
  const padCount = Math.max(0, bodyRows - bodyLines.length);
  const padLines = Array.from({ length: padCount }, () => paintBlankLine(width));
  const padScreenRows: ScreenRow[] = Array.from({ length: padCount }, () => ({ kind: "chrome" as const, index: null }));

  const lines = [header, rule, ...bodyLines, ...padLines, ...panelLines, paintStatus(width, truecolor, statusMessage)].slice(
    0,
    height,
  );

  const allRows: ScreenRow[] = [
    { kind: "chrome", index: null },
    { kind: "chrome", index: null },
    ...bodyScreenRows,
    ...padScreenRows,
    ...panelScreenRows,
    { kind: "chrome", index: null },
  ];

  const rows = allRows.slice(0, height);

  const map: ScreenMap = { rows, panes };

  return { lines, map };
}

export function paintSplit(options: PaintOptions): PaintResult {
  const { model, width, height, path, tokens, truecolor, rowBand, scrollTop, selection, notes, mode } = options;

  const numberWidth = computeNumberWidth(model);
  const hasLeftMarkerColumn = hasPaneNotes(notes, "left");
  const hasRightMarkerColumn = hasPaneNotes(notes, "right");
  const leftMarkerWidth = hasLeftMarkerColumn ? MARKER_WIDTH : 0;
  const rightMarkerWidth = hasRightMarkerColumn ? MARKER_WIDTH : 0;

  const fixedWidth =
    PANE_COUNT * (numberWidth + GUTTER_SPACE_WIDTH + SIGN_BAR_WIDTH) + DIVIDER_WIDTH + leftMarkerWidth + rightMarkerWidth;
  const remaining = Math.max(0, width - fixedWidth);
  const leftPaneWidth = Math.floor(remaining / PANE_COUNT);
  const rightPaneWidth = remaining - leftPaneWidth;

  const leftTextStart = numberWidth + GUTTER_SPACE_WIDTH + SIGN_BAR_WIDTH + leftMarkerWidth;
  const leftTextEnd = leftTextStart + leftPaneWidth;
  const rightGutterStart = leftTextEnd + DIVIDER_WIDTH;
  const rightTextStart = rightGutterStart + numberWidth + GUTTER_SPACE_WIDTH + SIGN_BAR_WIDTH + rightMarkerWidth;
  const rightTextEnd = rightTextStart + rightPaneWidth;

  const leftBounds: PaneBounds = { pane: "left", gutterStart: 0, textStart: leftTextStart, textEnd: leftTextEnd };
  const rightBounds: PaneBounds = {
    pane: "right",
    gutterStart: rightGutterStart,
    textStart: rightTextStart,
    textEnd: rightTextEnd,
  };

  const addCount = model.rows.filter((row) => row.kind === "add" || row.kind === "replace").length;
  const delCount = model.rows.filter((row) => row.kind === "del" || row.kind === "replace").length;

  const bodyRows = bodyHeight(height, notes.length, mode);
  const visible = visibleRows(model).slice(scrollTop, scrollTop + bodyRows);

  const bodyLines = visible.map((entry) =>
    entry.kind === "fold"
      ? paintFoldRow(lookupFold(model, entry.foldIndex), width, truecolor)
      : paintModelRow(
          lookupRow(model, entry.index),
          entry.index,
          leftBounds,
          rightBounds,
          numberWidth,
          tokens,
          rowBand,
          truecolor,
          selection,
          notes,
          hasLeftMarkerColumn,
          hasRightMarkerColumn,
        ),
  );

  const bodyScreenRows: ScreenRow[] = visible.map((entry) =>
    entry.kind === "fold" ? { kind: "fold", index: entry.foldIndex } : { kind: "row", index: entry.index },
  );

  const panel = buildPanel(options, width, truecolor);

  return assembleScreen(
    paintHeader(path, addCount, delCount, width, truecolor),
    paintRule(width, truecolor),
    bodyLines,
    bodyScreenRows,
    bodyRows,
    panel.lines,
    panel.screenRows,
    null,
    width,
    height,
    truecolor,
    [leftBounds, rightBounds],
  );
}

const UNIFIED_SIGN_BAR: Record<UnifiedHalfKind, UnifiedBarStyle> = {
  context: { char: " ", color: null },
  add: { char: "▌", color: theme.addBar },
  del: { char: "▌", color: theme.delBar },
};

function paintUnifiedHalf(
  halfKind: UnifiedHalfKind,
  lineNumber: number | null,
  text: string,
  tokens: SyntaxToken[],
  spans: Span[],
  changeColor: string | null,
  numberWidth: number,
  textWidth: number,
  rowBand: boolean,
  truecolor: boolean,
  highlightSpans: Span[],
  hasMarkerColumn: boolean,
  annotated: boolean,
): string {
  const bar = UNIFIED_SIGN_BAR[halfKind];
  const rendered = renderPaneText(text, tokens, spans, changeColor, textWidth, rowBand, truecolor, highlightSpans);

  return (
    paintGutter(lineNumber, numberWidth, truecolor) +
    paintSignBar(bar.char, bar.color, truecolor) +
    paintMarkerColumn(hasMarkerColumn, annotated, truecolor) +
    " ".repeat(TEXT_GAP_WIDTH) +
    rendered +
    RESET
  );
}

function paintUnifiedBodyEntry(
  entry: VisibleRow,
  model: DiffModel,
  numberWidth: number,
  textWidth: number,
  width: number,
  tokens: TokenProvider,
  rowBand: boolean,
  truecolor: boolean,
  selection: Selection | null,
  notes: Note[],
  hasMarkerColumn: boolean,
): UnifiedBodyEntry {
  if (entry.kind === "fold") {
    return {
      lines: [paintFoldRow(lookupFold(model, entry.foldIndex), width, truecolor)],
      screenRows: [{ kind: "fold", index: entry.foldIndex }],
    };
  }

  const row = lookupRow(model, entry.index);
  const spans = changedSpans(row.left, row.right);
  const screenRow: ScreenRow = { kind: "row", index: entry.index };
  const hasSelection = selection !== null && selection.pane === "right";

  if (row.kind === "context") {
    const selectionSpan = hasSelection ? selectionSpanFor(selection, entry.index, row.right.length) : null;
    const highlights = [...(selectionSpan === null ? [] : [selectionSpan]), ...noteSpansFor(notes, entry.index, "right")];
    const line = paintUnifiedHalf(
      "context",
      row.rightNumber,
      row.right,
      tokens(row.right, row.rightNumber),
      [],
      null,
      numberWidth,
      textWidth,
      rowBand,
      truecolor,
      highlights,
      hasMarkerColumn,
      isAnnotatedRow(notes, entry.index, "right"),
    );

    return { lines: [line], screenRows: [screenRow] };
  }

  if (row.kind === "add") {
    const selectionSpan = hasSelection ? selectionSpanFor(selection, entry.index, row.right.length) : null;
    const highlights = [...(selectionSpan === null ? [] : [selectionSpan]), ...noteSpansFor(notes, entry.index, "right")];
    const line = paintUnifiedHalf(
      "add",
      row.rightNumber,
      row.right,
      tokens(row.right, row.rightNumber),
      spans.right,
      theme.addSpan,
      numberWidth,
      textWidth,
      rowBand,
      truecolor,
      highlights,
      hasMarkerColumn,
      isAnnotatedRow(notes, entry.index, "right"),
    );

    return { lines: [line], screenRows: [screenRow] };
  }

  if (row.kind === "del") {
    const selectionSpan = hasSelection ? selectionSpanFor(selection, entry.index, row.left.length) : null;
    const highlights = [...(selectionSpan === null ? [] : [selectionSpan]), ...noteSpansFor(notes, entry.index, "left")];
    const line = paintUnifiedHalf(
      "del",
      row.leftNumber,
      row.left,
      tokens(row.left, row.leftNumber),
      spans.left,
      theme.delSpan,
      numberWidth,
      textWidth,
      rowBand,
      truecolor,
      highlights,
      hasMarkerColumn,
      isAnnotatedRow(notes, entry.index, "left"),
    );

    return { lines: [line], screenRows: [screenRow] };
  }

  const delSelectionSpan = hasSelection ? selectionSpanFor(selection, entry.index, row.left.length) : null;
  const addSelectionSpan = hasSelection ? selectionSpanFor(selection, entry.index, row.right.length) : null;
  const delHighlights = [...(delSelectionSpan === null ? [] : [delSelectionSpan]), ...noteSpansFor(notes, entry.index, "left")];
  const addHighlights = [...(addSelectionSpan === null ? [] : [addSelectionSpan]), ...noteSpansFor(notes, entry.index, "right")];

  const delLine = paintUnifiedHalf(
    "del",
    row.leftNumber,
    row.left,
    tokens(row.left, row.leftNumber),
    spans.left,
    theme.delSpan,
    numberWidth,
    textWidth,
    rowBand,
    truecolor,
    delHighlights,
    hasMarkerColumn,
    isAnnotatedRow(notes, entry.index, "left"),
  );

  const addLine = paintUnifiedHalf(
    "add",
    row.rightNumber,
    row.right,
    tokens(row.right, row.rightNumber),
    spans.right,
    theme.addSpan,
    numberWidth,
    textWidth,
    rowBand,
    truecolor,
    addHighlights,
    hasMarkerColumn,
    isAnnotatedRow(notes, entry.index, "right"),
  );

  return { lines: [delLine, addLine], screenRows: [screenRow, screenRow] };
}

export function paintUnified(options: PaintOptions): PaintResult {
  const { model, width, height, path, tokens, truecolor, rowBand, scrollTop, selection, notes, mode } = options;

  const numberWidth = computeNumberWidth(model);
  const hasMarkerColumn = notes.length > 0;
  const markerWidth = hasMarkerColumn ? MARKER_WIDTH : 0;

  const fixedWidth = UNIFIED_PANE_COUNT * (numberWidth + GUTTER_SPACE_WIDTH + SIGN_BAR_WIDTH) + markerWidth + TEXT_GAP_WIDTH;
  const textStart = fixedWidth;
  const textWidth = Math.max(0, width - fixedWidth);
  const textEnd = textStart + textWidth;

  const rightBounds: PaneBounds = { pane: "right", gutterStart: 0, textStart, textEnd };

  const addCount = model.rows.filter((row) => row.kind === "add" || row.kind === "replace").length;
  const delCount = model.rows.filter((row) => row.kind === "del" || row.kind === "replace").length;

  const bodyRows = bodyHeight(height, notes.length, mode);
  const visible = visibleRows(model).slice(scrollTop, scrollTop + bodyRows);

  const entries = visible.map((entry) =>
    paintUnifiedBodyEntry(entry, model, numberWidth, textWidth, width, tokens, rowBand, truecolor, selection, notes, hasMarkerColumn),
  );

  const rawBodyLines = entries.flatMap((entry) => entry.lines);
  const rawBodyScreenRows = entries.flatMap((entry) => entry.screenRows);

  const bodyLines = rawBodyLines.slice(0, bodyRows);
  const bodyScreenRows = rawBodyScreenRows.slice(0, bodyRows);

  const statusMessage = layoutStatusMessage(options);
  const panel = buildPanel(options, width, truecolor);

  return assembleScreen(
    paintHeader(path, addCount, delCount, width, truecolor),
    paintRule(width, truecolor),
    bodyLines,
    bodyScreenRows,
    bodyRows,
    panel.lines,
    panel.screenRows,
    statusMessage,
    width,
    height,
    truecolor,
    [rightBounds],
  );
}
