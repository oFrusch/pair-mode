import { isHexColor } from "../../helpers/hexColor";
import type { SyntaxToken } from "../../tui/paint";
import type { WebNote } from "../notes.types";
import type { WebReview, WebRow } from "../review.types";
import type { MarkRange, Pane, SpanRange } from "./markup.types";

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

function cellHtml(notes: readonly WebNote[], row: WebRow, rowIndex: number, pane: Pane): string {
  const text = textOf(row, pane);
  const body = paintCell(text, tokensOf(row, pane), marksFor(notes, rowIndex, pane, text.length));

  return (
    '<td class="num ' +
    pane +
    '">' +
    (numberOf(row, pane) ?? "") +
    "</td>" +
    '<td class="bar ' +
    pane +
    '"></td>' +
    '<td class="code ' +
    pane +
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

export function tableHtml(
  review: WebReview,
  notes: readonly WebNote[],
  expanded: ReadonlySet<number>,
): string {
  const hidden = hiddenRows(review, expanded);
  const byStart = foldsByStart(review);
  const parts: string[] = ["<table>"];

  review.rows.forEach((row, index) => {
    const foldIndex = byStart.get(index);
    const fold = foldIndex === undefined ? undefined : review.folds[foldIndex];

    if (foldIndex !== undefined && fold !== undefined && !expanded.has(foldIndex)) {
      parts.push(
        '<tr class="fold" data-fold="' +
          foldIndex +
          '"><td colspan="6">' +
          fold.count +
          " unchanged lines</td></tr>",
      );
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

  const start = numberOf(startRow, note.pane);
  const end = numberOf(endRow, note.pane);

  return start === end || end === null ? "L" + start : "L" + start + "-" + end;
}

export function notesHtml(review: WebReview, notes: readonly WebNote[]): string {
  return notes
    .map(
      (note, index) =>
        '<div class="note"><button class="drop" data-drop="' +
        index +
        '">&times;</button>' +
        '<div class="where">' +
        escapeHtml(labelOf(review, note)) +
        "</div>" +
        '<div class="quote">' +
        escapeHtml(quoteOf(review, note)) +
        "</div>" +
        '<div class="body">' +
        escapeHtml(note.text) +
        "</div></div>",
    )
    .join("");
}

// The panel matches the order the agent receives, so a note sits where its line sits.
export function sortedNotes(notes: readonly WebNote[]): WebNote[] {
  return [...notes].sort((first, second) =>
    first.startRow === second.startRow
      ? first.startColumn - second.startColumn
      : first.startRow - second.startRow,
  );
}
