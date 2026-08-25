import { basename } from "node:path";
import { visibleRows } from "../model/model";
import type {
  DiffModel,
  FoldGroup,
  ModelRow,
  PaneBounds,
  RowKind,
  ScreenMap,
  ScreenRow,
  VisibleRow,
} from "../model/model.types";
import type { Note } from "../notes/notes.types";
import { selectionSpanFor } from "../selection";
import type { Selection } from "../selection/selection.types";
import type { Mode } from "../tui.types";
import { changedSpans, layoutStatusMessage } from "./paint";
import { bg, DEFAULT_BG, DEFAULT_FG, fg, RESET, theme } from "./theme";
import type {
  NotePosition,
  PaintOptions,
  PaintResult,
  PaneTextScan,
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
const NO_PANEL_HEIGHT = 0;
const ANCHORED_CONNECTOR = "╰─";
const ANCHORED_FOCUSED_CONNECTOR = "╰▸";
const ANCHORED_CONNECTOR_GAP = " ";

const SIGN_BAR: Record<RowKind, SignBarStyle> = {
  context: { leftChar: " ", leftColor: null, rightChar: " ", rightColor: null },
  add: { leftChar: " ", leftColor: null, rightChar: "▌", rightColor: theme.addBar },
  del: { leftChar: "▌", leftColor: theme.delBar, rightChar: " ", rightColor: null },
  replace: { leftChar: "▌", leftColor: theme.delBar, rightChar: "▌", rightColor: theme.addBar },
};

export function panelHeight(noteCount: number, mode: Mode, notePosition: NotePosition): number {
  if (mode === "confirm") {
    return CONFIRM_PANEL_HEIGHT;
  }

  if (notePosition === "anchored") {
    return NO_PANEL_HEIGHT;
  }

  const draftRows = mode === "note" ? PANEL_DRAFT_ROWS : 0;
  const rowCount = noteCount + draftRows;

  return rowCount === 0 ? 0 : Math.min(rowCount + PANEL_TITLE_ROWS, PANEL_MAX_HEIGHT);
}

export function bodyHeight(
  height: number,
  noteCount: number,
  mode: Mode,
  notePosition: NotePosition,
): number {
  return Math.max(
    height - HEADER_ROWS - STATUS_ROWS - panelHeight(noteCount, mode, notePosition),
    MIN_BODY_HEIGHT,
  );
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

function paintGutter(
  lineNumber: number | null,
  numberWidth: number,
  truecolor: boolean,
  cursorRow: boolean,
): string {
  const text = lineNumber === null ? "" : String(lineNumber);

  // The cursor row marks itself by recolouring the gutter, so it costs no column.
  const color = cursorRow ? theme.chrome : theme.fold;

  return fg(color, truecolor) + text.padStart(numberWidth, " ") + " " + DEFAULT_FG;
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
  const columns = Array.from({ length: paneWidth }, (_, column) => column);

  const scan = columns.reduce<PaneTextScan>(
    (state, column) => {
      const char = column < textLength ? text.charAt(column) : " ";
      const token =
        column < textLength
          ? tokens.find((candidate) => column >= candidate.start && column < candidate.end)
          : undefined;
      const desiredFg = token === undefined ? null : token.color;

      const withinSpan = changeSpansForSide.some(
        (span) => column >= span.start && column < span.end,
      );
      const withinHighlight = highlightSpans.some(
        (span) => column >= span.start && column < span.end,
      );
      const desiredBg = withinHighlight
        ? theme.selection
        : changeColor !== null && (rowBand || withinSpan)
          ? changeColor
          : null;

      // An escape goes out only where the wanted colour differs from the colour already in force.
      const fgEscape =
        desiredFg === state.currentFg
          ? ""
          : desiredFg === null
            ? DEFAULT_FG
            : fg(desiredFg, truecolor);

      const bgEscape =
        desiredBg === state.currentBg
          ? ""
          : desiredBg === null
            ? DEFAULT_BG
            : bg(desiredBg, truecolor);

      return {
        output: state.output + fgEscape + bgEscape + char,
        currentFg: desiredFg,
        currentBg: desiredBg,
      };
    },
    { output: "", currentFg: undefined, currentBg: undefined },
  );

  return scan.output;
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
  cursorRow: boolean,
): string {
  const bar = SIGN_BAR[row.kind];
  const spans = changedSpans(row.left, row.right);

  const leftColor = row.kind === "del" || row.kind === "replace" ? theme.delSpan : null;
  const rightColor = row.kind === "add" || row.kind === "replace" ? theme.addSpan : null;

  const leftPaneWidth = leftBounds.textEnd - leftBounds.textStart;
  const rightPaneWidth = rightBounds.textEnd - rightBounds.textStart;

  const leftSelectionSpan =
    selection !== null && selection.pane === "left"
      ? selectionSpanFor(selection, rowIndex, row.left.length)
      : null;
  const rightSelectionSpan =
    selection !== null && selection.pane === "right"
      ? selectionSpanFor(selection, rowIndex, row.right.length)
      : null;

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
    paintGutter(row.leftNumber, numberWidth, truecolor, cursorRow) +
    paintSignBar(bar.leftChar, bar.leftColor, truecolor) +
    paintMarkerColumn(hasLeftMarkerColumn, isAnnotatedRow(notes, rowIndex, "left"), truecolor) +
    leftText +
    divider +
    paintGutter(row.rightNumber, numberWidth, truecolor, cursorRow) +
    paintSignBar(bar.rightChar, bar.rightColor, truecolor) +
    paintMarkerColumn(hasRightMarkerColumn, isAnnotatedRow(notes, rowIndex, "right"), truecolor) +
    rightText +
    RESET
  );
}

function paintFoldRow(
  fold: FoldGroup,
  width: number,
  truecolor: boolean,
  cursorRow: boolean,
): string {
  const label = `⋯ ${fold.count} unchanged lines`;
  const totalPadding = Math.max(0, width - label.length);
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;

  // A fold row on the cursor recolours its label, the same zero-width marker the gutter uses.
  const color = cursorRow ? theme.chrome : theme.fold;

  return fg(color, truecolor) + " ".repeat(leftPadding) + label + " ".repeat(rightPadding) + RESET;
}

function paintHeader(
  path: string,
  addCount: number,
  delCount: number,
  width: number,
  truecolor: boolean,
): string {
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

// Without these the status bar is a blank strip, and every key in the TUI is undiscoverable.
const KEY_HINTS = [
  "j/k move",
  "^d/^u page",
  "n/N hunk",
  "v select",
  "a note",
  "tab cycle",
  "d delete",
  "space fold",
  "u layout",
  "^s send",
  "^q quit",
  "? keys",
];

const HINT_SEPARATOR = " · ";

// A narrow bar drops whole hints from the tail rather than cutting one mid-word.
function fitHints(width: number): string {
  return KEY_HINTS.reduce((kept, hint) => {
    const candidate = kept === "" ? hint : kept + HINT_SEPARATOR + hint;

    return candidate.length <= width ? candidate : kept;
  }, "");
}

// The bar fills with theme.chrome, so it needs a dark foreground. The terminal default is light on a dark theme.
function paintStatus(width: number, truecolor: boolean, message: string | null): string {
  const text = message === null ? fitHints(width) : message.slice(0, width);
  const padding = " ".repeat(Math.max(0, width - text.length));

  return bg(theme.chrome, truecolor) + fg(theme.statusText, truecolor) + text + padding + RESET;
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

  return padPanelLine(
    fg(theme.note, truecolor) + marker + DEFAULT_FG + rest,
    marker.length + rest.length,
    width,
  );
}

function paintDraftRow(draft: string, width: number, truecolor: boolean): string {
  const text = draft.slice(0, Math.max(0, width - CURSOR_WIDTH));
  const cursor = bg(theme.chrome, truecolor) + " " + DEFAULT_BG;

  return padPanelLine(text + cursor, text.length + CURSOR_WIDTH, width);
}

function paintAnchoredNoteRow(
  note: Note,
  focused: boolean,
  width: number,
  truecolor: boolean,
): string {
  const connector = focused ? ANCHORED_FOCUSED_CONNECTOR : ANCHORED_CONNECTOR;
  const maxTextWidth = Math.max(0, width - connector.length - ANCHORED_CONNECTOR_GAP.length);
  const text = note.text.slice(0, maxTextWidth);
  const content =
    fg(theme.fold, truecolor) +
    connector +
    DEFAULT_FG +
    ANCHORED_CONNECTOR_GAP +
    fg(theme.note, truecolor) +
    text +
    DEFAULT_FG;
  const plainLength = connector.length + ANCHORED_CONNECTOR_GAP.length + text.length;

  return padPanelLine(content, plainLength, width);
}

function paintAnchoredDraftRow(draft: string, width: number, truecolor: boolean): string {
  const connector = ANCHORED_CONNECTOR;
  const maxTextWidth = Math.max(
    0,
    width - connector.length - ANCHORED_CONNECTOR_GAP.length - CURSOR_WIDTH,
  );
  const text = draft.slice(0, maxTextWidth);
  const cursor = bg(theme.chrome, truecolor) + " " + DEFAULT_BG;
  const content =
    fg(theme.fold, truecolor) + connector + DEFAULT_FG + ANCHORED_CONNECTOR_GAP + text + cursor;
  const plainLength = connector.length + ANCHORED_CONNECTOR_GAP.length + text.length + CURSOR_WIDTH;

  return padPanelLine(content, plainLength, width);
}

function draftAnchorRowFor(selection: Selection | null): number | null {
  return selection === null ? null : Math.min(selection.anchorRow, selection.headRow);
}

function anchoredNoteRowsFor(
  rowIndex: number,
  notes: Note[],
  focusedNote: number | null,
  width: number,
  truecolor: boolean,
): UnifiedBodyEntry {
  const rowNotes = notes
    .filter((note) => note.rowIndex === rowIndex)
    .sort((left, right) => left.id - right.id);
  const chromeRow: ScreenRow = { kind: "chrome", index: null };

  return {
    lines: rowNotes.map((note) =>
      paintAnchoredNoteRow(note, note.id === focusedNote, width, truecolor),
    ),
    screenRows: rowNotes.map(() => chromeRow),
  };
}

function anchoredExtrasFor(
  rowIndex: number,
  options: PaintOptions,
  width: number,
  truecolor: boolean,
): UnifiedBodyEntry {
  const { notes, focusedNote, mode, draft, selection } = options;
  const noteEntries = anchoredNoteRowsFor(rowIndex, notes, focusedNote, width, truecolor);
  const showDraft = mode === "note" && draftAnchorRowFor(selection) === rowIndex;

  if (!showDraft) {
    return noteEntries;
  }

  const chromeRow: ScreenRow = { kind: "chrome", index: null };

  return {
    lines: [...noteEntries.lines, paintAnchoredDraftRow(draft, width, truecolor)],
    screenRows: [...noteEntries.screenRows, chromeRow],
  };
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

  const content = choices
    .map(([key, label]) => bg(theme.chrome, truecolor) + key + DEFAULT_BG + label)
    .join("");
  const plainLength = choices.reduce((sum, [key, label]) => sum + key.length + label.length, 0);

  return padPanelLine(content, plainLength, width);
}

function buildPanel(options: PaintOptions, width: number, truecolor: boolean): UnifiedBodyEntry {
  const { notes, focusedNote, mode, draft, notePosition } = options;
  const height = panelHeight(notes.length, mode, notePosition);

  if (height === 0) {
    return { lines: [], screenRows: [] };
  }

  const chromeRow: ScreenRow = { kind: "chrome", index: null };

  if (mode === "confirm") {
    return {
      lines: [
        paintConfirmSummary(notes.length, width, truecolor),
        paintConfirmChoices(width, truecolor),
      ],
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
  const padScreenRows: ScreenRow[] = Array.from({ length: padCount }, () => ({
    kind: "chrome" as const,
    index: null,
  }));

  const lines = [
    header,
    rule,
    ...bodyLines,
    ...padLines,
    ...panelLines,
    paintStatus(width, truecolor, statusMessage),
  ].slice(0, height);

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
  const {
    model,
    width,
    height,
    path,
    tokens,
    truecolor,
    rowBand,
    scrollTop,
    selection,
    notes,
    mode,
    notePosition,
  } = options;

  const numberWidth = computeNumberWidth(model);
  const hasLeftMarkerColumn = hasPaneNotes(notes, "left");
  const hasRightMarkerColumn = hasPaneNotes(notes, "right");
  const leftMarkerWidth = hasLeftMarkerColumn ? MARKER_WIDTH : 0;
  const rightMarkerWidth = hasRightMarkerColumn ? MARKER_WIDTH : 0;

  const fixedWidth =
    PANE_COUNT * (numberWidth + GUTTER_SPACE_WIDTH + SIGN_BAR_WIDTH) +
    DIVIDER_WIDTH +
    leftMarkerWidth +
    rightMarkerWidth;
  const remaining = Math.max(0, width - fixedWidth);
  const leftPaneWidth = Math.floor(remaining / PANE_COUNT);
  const rightPaneWidth = remaining - leftPaneWidth;

  const leftTextStart = numberWidth + GUTTER_SPACE_WIDTH + SIGN_BAR_WIDTH + leftMarkerWidth;
  const leftTextEnd = leftTextStart + leftPaneWidth;
  const rightGutterStart = leftTextEnd + DIVIDER_WIDTH;
  const rightTextStart =
    rightGutterStart + numberWidth + GUTTER_SPACE_WIDTH + SIGN_BAR_WIDTH + rightMarkerWidth;
  const rightTextEnd = rightTextStart + rightPaneWidth;

  const leftBounds: PaneBounds = {
    pane: "left",
    gutterStart: 0,
    textStart: leftTextStart,
    textEnd: leftTextEnd,
  };
  const rightBounds: PaneBounds = {
    pane: "right",
    gutterStart: rightGutterStart,
    textStart: rightTextStart,
    textEnd: rightTextEnd,
  };

  const addCount = model.rows.filter((row) => row.kind === "add" || row.kind === "replace").length;
  const delCount = model.rows.filter((row) => row.kind === "del" || row.kind === "replace").length;

  const bodyRows = bodyHeight(height, notes.length, mode, notePosition);
  const visible = visibleRows(model).slice(scrollTop, scrollTop + bodyRows);

  const bodyEntries: UnifiedBodyEntry[] = visible.map((entry, offset) => {
    // model.cursor indexes the visible rows, so the absolute index is the scroll top plus the offset.
    const cursorRow = scrollTop + offset === model.cursor;

    if (entry.kind === "fold") {
      return {
        lines: [paintFoldRow(lookupFold(model, entry.foldIndex), width, truecolor, cursorRow)],
        screenRows: [{ kind: "fold", index: entry.foldIndex }],
      };
    }

    const line = paintModelRow(
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
      cursorRow,
    );
    const screenRow: ScreenRow = { kind: "row", index: entry.index };
    const extras =
      notePosition === "anchored"
        ? anchoredExtrasFor(entry.index, options, width, truecolor)
        : { lines: [], screenRows: [] };

    return { lines: [line, ...extras.lines], screenRows: [screenRow, ...extras.screenRows] };
  });

  const bodyLines = bodyEntries.flatMap((entry) => entry.lines).slice(0, bodyRows);
  const bodyScreenRows = bodyEntries.flatMap((entry) => entry.screenRows).slice(0, bodyRows);

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
  cursorRow: boolean,
): string {
  const bar = UNIFIED_SIGN_BAR[halfKind];
  const rendered = renderPaneText(
    text,
    tokens,
    spans,
    changeColor,
    textWidth,
    rowBand,
    truecolor,
    highlightSpans,
  );

  return (
    paintGutter(lineNumber, numberWidth, truecolor, cursorRow) +
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
  cursorRow: boolean,
): UnifiedBodyEntry {
  if (entry.kind === "fold") {
    return {
      lines: [paintFoldRow(lookupFold(model, entry.foldIndex), width, truecolor, cursorRow)],
      screenRows: [{ kind: "fold", index: entry.foldIndex }],
    };
  }

  const row = lookupRow(model, entry.index);
  const spans = changedSpans(row.left, row.right);
  const screenRow: ScreenRow = { kind: "row", index: entry.index };
  const hasSelection = selection !== null && selection.pane === "right";

  if (row.kind === "context") {
    const selectionSpan = hasSelection
      ? selectionSpanFor(selection, entry.index, row.right.length)
      : null;
    const highlights = [
      ...(selectionSpan === null ? [] : [selectionSpan]),
      ...noteSpansFor(notes, entry.index, "right"),
    ];
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
      cursorRow,
    );

    return { lines: [line], screenRows: [screenRow] };
  }

  if (row.kind === "add") {
    const selectionSpan = hasSelection
      ? selectionSpanFor(selection, entry.index, row.right.length)
      : null;
    const highlights = [
      ...(selectionSpan === null ? [] : [selectionSpan]),
      ...noteSpansFor(notes, entry.index, "right"),
    ];
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
      cursorRow,
    );

    return { lines: [line], screenRows: [screenRow] };
  }

  if (row.kind === "del") {
    const selectionSpan = hasSelection
      ? selectionSpanFor(selection, entry.index, row.left.length)
      : null;
    const highlights = [
      ...(selectionSpan === null ? [] : [selectionSpan]),
      ...noteSpansFor(notes, entry.index, "left"),
    ];
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
      cursorRow,
    );

    return { lines: [line], screenRows: [screenRow] };
  }

  const delSelectionSpan = hasSelection
    ? selectionSpanFor(selection, entry.index, row.left.length)
    : null;
  const addSelectionSpan = hasSelection
    ? selectionSpanFor(selection, entry.index, row.right.length)
    : null;
  const delHighlights = [
    ...(delSelectionSpan === null ? [] : [delSelectionSpan]),
    ...noteSpansFor(notes, entry.index, "left"),
  ];
  const addHighlights = [
    ...(addSelectionSpan === null ? [] : [addSelectionSpan]),
    ...noteSpansFor(notes, entry.index, "right"),
  ];

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
    cursorRow,
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
    cursorRow,
  );

  return { lines: [delLine, addLine], screenRows: [screenRow, screenRow] };
}

export function paintUnified(options: PaintOptions): PaintResult {
  const {
    model,
    width,
    height,
    path,
    tokens,
    truecolor,
    rowBand,
    scrollTop,
    selection,
    notes,
    mode,
    notePosition,
  } = options;

  const numberWidth = computeNumberWidth(model);
  const hasMarkerColumn = notes.length > 0;
  const markerWidth = hasMarkerColumn ? MARKER_WIDTH : 0;

  const fixedWidth =
    UNIFIED_PANE_COUNT * (numberWidth + GUTTER_SPACE_WIDTH + SIGN_BAR_WIDTH) +
    markerWidth +
    TEXT_GAP_WIDTH;
  const textStart = fixedWidth;
  const textWidth = Math.max(0, width - fixedWidth);
  const textEnd = textStart + textWidth;

  const rightBounds: PaneBounds = { pane: "right", gutterStart: 0, textStart, textEnd };

  const addCount = model.rows.filter((row) => row.kind === "add" || row.kind === "replace").length;
  const delCount = model.rows.filter((row) => row.kind === "del" || row.kind === "replace").length;

  const bodyRows = bodyHeight(height, notes.length, mode, notePosition);
  const visible = visibleRows(model).slice(scrollTop, scrollTop + bodyRows);

  const entries = visible.map((entry, offset) => {
    // model.cursor indexes the visible rows, so the absolute index is the scroll top plus the offset.
    const cursorRow = scrollTop + offset === model.cursor;

    const base = paintUnifiedBodyEntry(
      entry,
      model,
      numberWidth,
      textWidth,
      width,
      tokens,
      rowBand,
      truecolor,
      selection,
      notes,
      hasMarkerColumn,
      cursorRow,
    );

    if (notePosition !== "anchored" || entry.kind === "fold") {
      return base;
    }

    const extras = anchoredExtrasFor(entry.index, options, width, truecolor);

    return {
      lines: [...base.lines, ...extras.lines],
      screenRows: [...base.screenRows, ...extras.screenRows],
    };
  });

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
