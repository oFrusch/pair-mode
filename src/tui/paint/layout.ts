import { basename } from "node:path";
import { visibleRows } from "../model/model";
import type { DiffModel, FoldGroup, ModelRow, PaneBounds, RowKind, ScreenMap, ScreenRow } from "../model/model.types";
import { changedSpans } from "./paint";
import { bg, DEFAULT_BG, DEFAULT_FG, fg, RESET, theme } from "./theme";
import type { PaintOptions, PaintResult, SignBarStyle, Span, SyntaxToken, TokenProvider } from "./paint.types";

const NUMBER_WIDTH_FLOOR = 2;
const GUTTER_SPACE_WIDTH = 1;
const SIGN_BAR_WIDTH = 1;
const DIVIDER_WIDTH = 1;
const PANE_COUNT = 2;
const HEADER_ROWS = 2;
const STATUS_ROWS = 1;
const HEADER_COUNT_GAP_WIDTH = 1;

const SIGN_BAR: Record<RowKind, SignBarStyle> = {
  context: { leftChar: " ", leftColor: null, rightChar: " ", rightColor: null },
  add: { leftChar: " ", leftColor: null, rightChar: "▌", rightColor: theme.addBar },
  del: { leftChar: "▌", leftColor: theme.delBar, rightChar: " ", rightColor: null },
  replace: { leftChar: "▌", leftColor: theme.delBar, rightChar: "▌", rightColor: theme.addBar },
};

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
    const desiredBg = changeColor !== null && (rowBand || withinSpan) ? changeColor : null;

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
  leftBounds: PaneBounds,
  rightBounds: PaneBounds,
  numberWidth: number,
  tokens: TokenProvider,
  rowBand: boolean,
  truecolor: boolean,
): string {
  const bar = SIGN_BAR[row.kind];
  const spans = changedSpans(row.left, row.right);

  const leftColor = row.kind === "del" || row.kind === "replace" ? theme.delSpan : null;
  const rightColor = row.kind === "add" || row.kind === "replace" ? theme.addSpan : null;

  const leftPaneWidth = leftBounds.textEnd - leftBounds.textStart;
  const rightPaneWidth = rightBounds.textEnd - rightBounds.textStart;

  const leftText = renderPaneText(
    row.left,
    tokens(row.left, row.leftNumber),
    spans.left,
    leftColor,
    leftPaneWidth,
    rowBand,
    truecolor,
  );

  const rightText = renderPaneText(
    row.right,
    tokens(row.right, row.rightNumber),
    spans.right,
    rightColor,
    rightPaneWidth,
    rowBand,
    truecolor,
  );

  const divider = fg(theme.fold, truecolor) + "│" + DEFAULT_FG;

  return (
    paintGutter(row.leftNumber, numberWidth, truecolor) +
    paintSignBar(bar.leftChar, bar.leftColor, truecolor) +
    leftText +
    divider +
    paintGutter(row.rightNumber, numberWidth, truecolor) +
    paintSignBar(bar.rightChar, bar.rightColor, truecolor) +
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

function paintStatus(width: number, truecolor: boolean): string {
  return bg(theme.chrome, truecolor) + " ".repeat(width) + RESET;
}

function paintBlankLine(width: number): string {
  return " ".repeat(width) + RESET;
}

export function paintSplit(options: PaintOptions): PaintResult {
  const { model, width, height, path, tokens, truecolor, rowBand, scrollTop } = options;

  const numberWidth = computeNumberWidth(model);

  const fixedWidth = PANE_COUNT * (numberWidth + GUTTER_SPACE_WIDTH + SIGN_BAR_WIDTH) + DIVIDER_WIDTH;
  const remaining = Math.max(0, width - fixedWidth);
  const leftPaneWidth = Math.floor(remaining / PANE_COUNT);
  const rightPaneWidth = remaining - leftPaneWidth;

  const leftTextStart = numberWidth + GUTTER_SPACE_WIDTH + SIGN_BAR_WIDTH;
  const leftTextEnd = leftTextStart + leftPaneWidth;
  const rightGutterStart = leftTextEnd + DIVIDER_WIDTH;
  const rightTextStart = rightGutterStart + numberWidth + GUTTER_SPACE_WIDTH + SIGN_BAR_WIDTH;
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

  const bodyHeight = Math.max(0, height - HEADER_ROWS - STATUS_ROWS);
  const visible = visibleRows(model).slice(scrollTop, scrollTop + bodyHeight);

  const bodyLines = visible.map((entry) =>
    entry.kind === "fold"
      ? paintFoldRow(lookupFold(model, entry.foldIndex), width, truecolor)
      : paintModelRow(lookupRow(model, entry.index), leftBounds, rightBounds, numberWidth, tokens, rowBand, truecolor),
  );

  const bodyScreenRows: ScreenRow[] = visible.map((entry) =>
    entry.kind === "fold" ? { kind: "fold", index: entry.foldIndex } : { kind: "row", index: entry.index },
  );

  const padCount = bodyHeight - bodyLines.length;
  const padLines = Array.from({ length: padCount }, () => paintBlankLine(width));
  const padScreenRows: ScreenRow[] = Array.from({ length: padCount }, () => ({ kind: "chrome" as const, index: null }));

  const lines = [
    paintHeader(path, addCount, delCount, width, truecolor),
    paintRule(width, truecolor),
    ...bodyLines,
    ...padLines,
    paintStatus(width, truecolor),
  ].slice(0, height);

  const allRows: ScreenRow[] = [
    { kind: "chrome", index: null },
    { kind: "chrome", index: null },
    ...bodyScreenRows,
    ...padScreenRows,
    { kind: "chrome", index: null },
  ];

  const rows = allRows.slice(0, height);

  const map: ScreenMap = { rows, panes: [leftBounds, rightBounds] };

  return { lines, map };
}
