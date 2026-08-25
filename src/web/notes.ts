import type { Question } from "../core/collect";
import { toQuestions } from "../tui/notes";
import type { Note } from "../tui/notes";
import type { WebReview, WebRow } from "./review.types";
import type { WebNote } from "./notes.types";

function textOf(row: WebRow, pane: "left" | "right"): string {
  return pane === "right" ? row.right : row.left;
}

function numberOf(row: WebRow, pane: "left" | "right"): number | null {
  return pane === "right" ? row.rightNumber : row.leftNumber;
}

function toNote(review: WebReview, note: WebNote, id: number): Note | null {
  const startRow = review.rows[note.startRow];
  const endRow = review.rows[note.endRow];
  const text = note.text.trim();

  if (startRow === undefined || endRow === undefined || text === "") {
    return null;
  }

  return {
    id,
    rowIndex: note.startRow,
    endRowIndex: note.endRow,
    pane: note.pane,
    startColumn: note.startColumn,
    endColumn: note.endColumn,
    line: numberOf(startRow, note.pane),
    endLine: numberOf(endRow, note.pane),
    code: textOf(startRow, note.pane),
    text,
  };
}

// The browser and the TUI share toQuestions, so one span suffix rule serves both clients.
export function webNotesToQuestions(review: WebReview, notes: WebNote[]): Question[] {
  const converted = notes
    .map((note, index) => toNote(review, note, index + 1))
    .filter((note): note is Note => note !== null);

  return toQuestions(converted);
}
