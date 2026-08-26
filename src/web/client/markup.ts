import { isHexColor } from "../../helpers/hexColor";
import type { SyntaxToken } from "../../tui/paint";
import type { WebNote } from "../notes.types";
import type { WebReview, WebRow } from "../review.types";
import type { InlineLine, MarkRange, Pane, SpanRange } from "./markup.types";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// Every value the page renders came from a file the agent touched, so nothing reaches the markup unescaped.
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

export function textOf(row: WebRow, pane: Pane): string {
  return pane === "right" ? row.right : row.left;
}

function tokensOf(row: WebRow, pane: Pane): SyntaxToken[] {
  return pane === "right" ? row.rightTokens : row.leftTokens;
}

function other(pane: Pane): Pane {
  return pane === "right" ? "left" : "right";
}

export function numberOf(row: WebRow, pane: Pane): number | null {
  return pane === "right" ? row.rightNumber : row.leftNumber;
}

// A note covers whole lines between its ends, so only the first and last rows carry a column range.
export function markRange(note: SpanRange, rowIndex: number, length: number): MarkRange {
  const start = rowIndex === note.startRow ? note.startColumn : 0;
  const end = rowIndex === note.endRow ? note.endColumn : length;

  return { start: Math.max(0, start), end: Math.min(length, end) };
}

export function marksFor(
  notes: readonly WebNote[],
  rowIndex: number,
  pane: Pane,
  length: number,
): MarkRange[] {
  return notes
    .filter((note) => note.pane === pane && rowIndex >= note.startRow && rowIndex <= note.endRow)
    .map((note) => markRange(note, rowIndex, length))
    .filter((range) => range.end > range.start);
}

// Escaping cannot stop a colour that is valid CSS, so only the hex shape a theme emits reaches a style attribute.
function colorAt(colors: readonly (string | null)[], index: number): string | null {
  const color = colors[index] ?? null;

  return color !== null && isHexColor(color) ? color : null;
}

// One pass per character keeps token colour and note highlight from fighting over the same span.
export function paintCell(
  text: string,
  tokens: readonly SyntaxToken[],
  marks: readonly MarkRange[],
): string {
  if (text === "") {
    return "";
  }

  const colors: (string | null)[] = Array.from({ length: text.length }, () => null);

  tokens.forEach((token) => {
    for (let index = token.start; index < token.end && index < text.length; index += 1) {
      colors[index] = token.color;
    }
  });

  const marked: boolean[] = Array.from({ length: text.length }, () => false);

  marks.forEach((range) => {
    for (let index = range.start; index < range.end; index += 1) {
      marked[index] = true;
    }
  });

  const parts: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let end = cursor + 1;

    while (
      end < text.length &&
      colorAt(colors, end) === colorAt(colors, cursor) &&
      marked[end] === marked[cursor]
    ) {
      end += 1;
    }

    const body = escapeHtml(text.slice(cursor, end));
    const color = colorAt(colors, cursor);
    const styled = color === null ? body : '<span style="color:' + color + '">' + body + "</span>";

    parts.push(marked[cursor] === true ? '<mark class="noted">' + styled + "</mark>" : styled);
    cursor = end;
  }

  return parts.join("");
}

export function hiddenRows(review: WebReview, expanded: ReadonlySet<number>): Set<number> {
  const hidden = new Set<number>();

  review.folds.forEach((fold, foldIndex) => {
    if (expanded.has(foldIndex)) {
      return;
    }

    for (let offset = 0; offset < fold.count; offset += 1) {
      hidden.add(fold.start + offset);
    }
  });

  return hidden;
}

// A row that changed on one side only pads the other, and that padding reads as void rather than as code.
function signOf(kind: string, pane: Pane): string {
  if (pane === "left") {
    return kind === "del" || kind === "replace" ? "-" : " ";
  }

  return kind === "add" || kind === "replace" ? "+" : " ";
}

function cellHtml(notes: readonly WebNote[], row: WebRow, rowIndex: number, pane: Pane): string {
  const text = textOf(row, pane);
  const body = paintCell(text, tokensOf(row, pane), marksFor(notes, rowIndex, pane, text.length));
  const number = numberOf(row, pane);
  const void_ = number === null ? " void" : "";

  return (
    '<td class="num ' +
    pane +
    void_ +
    '">' +
    (number ?? "") +
    "</td>" +
    '<td class="sign ' +
    pane +
    void_ +
    '">' +
    signOf(row.kind, pane) +
    "</td>" +
    '<td class="code ' +
    pane +
    void_ +
    '" data-row="' +
    rowIndex +
    '" data-pane="' +
    pane +
    '">' +
    body +
    "</td>"
  );
}

// A findIndex per row turns a long diff quadratic, so the fold starts are bucketed once.
function foldsByStart(review: WebReview): Map<number, number> {
  return new Map(review.folds.map((fold, foldIndex) => [fold.start, foldIndex]));
}

const SPLIT_COLUMNS = 6;
const INLINE_COLUMNS = 4;

function foldHtml(foldIndex: number, count: number, columns: number): string {
  return (
    '<tr class="fold" data-fold="' +
    foldIndex +
    '"><td colspan="' +
    columns +
    '">' +
    count +
    " unchanged lines</td></tr>"
  );
}

export function tableHtml(
  review: WebReview,
  notes: readonly WebNote[],
  expanded: ReadonlySet<number>,
): string {
  const hidden = hiddenRows(review, expanded);
  const byStart = foldsByStart(review);
  const parts: string[] = ['<table class="split">'];

  review.rows.forEach((row, index) => {
    const foldIndex = byStart.get(index);
    const fold = foldIndex === undefined ? undefined : review.folds[foldIndex];

    if (foldIndex !== undefined && fold !== undefined && !expanded.has(foldIndex)) {
      parts.push(foldHtml(foldIndex, fold.count, SPLIT_COLUMNS));
    }

    if (hidden.has(index)) {
      return;
    }

    parts.push(
      '<tr class="' +
        escapeHtml(row.kind) +
        '">' +
        cellHtml(notes, row, index, "left") +
        cellHtml(notes, row, index, "right") +
        "</tr>",
    );

    parts.push(threadsAt(review, notes, index, SPLIT_COLUMNS));
  });

  parts.push("</table>");

  return parts.join("");
}

// A replace row changed on both sides, so one column has to show the old line above the new one.
function inlineLines(kind: string): InlineLine[] {
  if (kind === "del") {
    return [{ pane: "left", sign: "-", kind: "del" }];
  }

  if (kind === "add") {
    return [{ pane: "right", sign: "+", kind: "add" }];
  }

  if (kind === "replace") {
    return [
      { pane: "left", sign: "-", kind: "del" },
      { pane: "right", sign: "+", kind: "add" },
    ];
  }

  return [{ pane: "right", sign: " ", kind: "context" }];
}

// A context row holds the same text on both sides, so a note taken in either pane still marks it.
function inlineMarks(
  notes: readonly WebNote[],
  rowIndex: number,
  kind: string,
  pane: Pane,
  length: number,
): MarkRange[] {
  if (kind !== "context") {
    return marksFor(notes, rowIndex, pane, length);
  }

  return [
    ...marksFor(notes, rowIndex, "left", length),
    ...marksFor(notes, rowIndex, "right", length),
  ];
}

// A del row renders no right line, so a note taken on that side anchors to the line the row does render.
function anchorsHere(line: InlineLine, panes: readonly Pane[], notePane: Pane): boolean {
  return line.pane === notePane || !panes.includes(notePane);
}

// One line can carry several notes, so the anchor holds every index that starts here.
function anchorsAt(
  notes: readonly WebNote[],
  rowIndex: number,
  line: InlineLine,
  panes: readonly Pane[],
): number[] {
  return notes
    .map((note, index) => ({ note, index }))
    .filter(
      (entry) => entry.note.startRow === rowIndex && anchorsHere(line, panes, entry.note.pane),
    )
    .map((entry) => entry.index);
}

function inlineRowHtml(
  review: WebReview,
  notes: readonly WebNote[],
  rowIndex: number,
  line: InlineLine,
  panes: readonly Pane[],
): string {
  const row = review.rows[rowIndex];

  if (row === undefined) {
    return "";
  }

  const text = textOf(row, line.pane);
  const body = paintCell(
    text,
    tokensOf(row, line.pane),
    inlineMarks(notes, rowIndex, row.kind, line.pane, text.length),
  );
  const anchors = anchorsAt(notes, rowIndex, line, panes);
  const leftNumber = line.pane === "left" ? (row.leftNumber ?? "") : "";
  const rightNumber = line.pane === "right" ? (row.rightNumber ?? "") : "";

  return (
    '<tr class="' +
    line.kind +
    '"' +
    (anchors.length === 0 ? "" : ' data-anchor="' + anchors.join(" ") + '"') +
    '><td class="num old">' +
    leftNumber +
    '</td><td class="num new">' +
    rightNumber +
    '</td><td class="sign ' +
    line.pane +
    '">' +
    line.sign +
    '</td><td class="code ' +
    line.pane +
    '" data-row="' +
    rowIndex +
    '" data-pane="' +
    line.pane +
    '">' +
    body +
    "</td></tr>"
  );
}

export function inlineHtml(
  review: WebReview,
  notes: readonly WebNote[],
  expanded: ReadonlySet<number>,
): string {
  const hidden = hiddenRows(review, expanded);
  const byStart = foldsByStart(review);
  const parts: string[] = ['<table class="inline">'];

  review.rows.forEach((row, index) => {
    const foldIndex = byStart.get(index);
    const fold = foldIndex === undefined ? undefined : review.folds[foldIndex];

    if (foldIndex !== undefined && fold !== undefined && !expanded.has(foldIndex)) {
      parts.push(foldHtml(foldIndex, fold.count, INLINE_COLUMNS));
    }

    if (hidden.has(index)) {
      return;
    }

    const lines = inlineLines(row.kind);
    const panes = lines.map((line) => line.pane);

    lines.forEach((line) => {
      parts.push(inlineRowHtml(review, notes, index, line, panes));
    });
  });

  parts.push("</table>");

  return parts.join("");
}

export function quoteOf(review: WebReview, note: SpanRange): string {
  const row = review.rows[note.startRow];

  if (row === undefined) {
    return "";
  }

  const text = textOf(row, note.pane);
  const end = note.endRow > note.startRow ? text.length : note.endColumn;

  return text.slice(note.startColumn, end).trim();
}

export function labelOf(review: WebReview, note: SpanRange): string {
  const startRow = review.rows[note.startRow];
  const endRow = review.rows[note.endRow];

  if (startRow === undefined || endRow === undefined) {
    return "";
  }

  // A selection can start on the padding side of a row, and that side carries no line number.
  const start = numberOf(startRow, note.pane) ?? numberOf(startRow, other(note.pane));
  const end = numberOf(endRow, note.pane);

  if (start === null) {
    return "";
  }

  return start === end || end === null ? "L" + start : "L" + start + "-" + end;
}

// A thread renders under the last line its note covers, so the note reads as a reply to that line.
function threadsAt(
  review: WebReview,
  notes: readonly WebNote[],
  rowIndex: number,
  columns: number,
): string {
  return notes
    .map((note, index) => ({ note, index }))
    .filter((entry) => entry.note.endRow === rowIndex)
    .map(
      (entry) =>
        '<tr class="thread"><td colspan="' +
        columns +
        '"><button class="drop" data-drop="' +
        entry.index +
        '" aria-label="Remove note">&times;</button><div class="at">' +
        escapeHtml(labelOf(review, entry.note)) +
        "</div><p>" +
        escapeHtml(entry.note.text) +
        "</p></td></tr>",
    )
    .join("");
}

// The inline layout keeps notes out of the code column, so each one gets a card the margin can place.
export function marginNotesHtml(review: WebReview, notes: readonly WebNote[]): string {
  return notes
    .map(
      (note, index) =>
        '<div class="note" data-card="' +
        index +
        '"><button class="drop" data-drop="' +
        index +
        '" aria-label="Remove note">&times;</button><div class="at">' +
        escapeHtml(labelOf(review, note)) +
        "</div><p>" +
        escapeHtml(note.text) +
        "</p></div>",
    )
    .join("");
}

// The notes reach the agent in this order, so a note sits where its line sits.
export function sortedNotes(notes: readonly WebNote[]): WebNote[] {
  return [...notes].sort((first, second) =>
    first.startRow === second.startRow
      ? first.startColumn - second.startColumn
      : first.startRow - second.startRow,
  );
}
