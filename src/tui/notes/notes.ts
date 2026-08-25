import { writeFileSync } from "node:fs";
import type { Question } from "../../core/collect";
import type { DiffModel } from "../model";
import type { Selection } from "../selection/selection.types";
import type { Note, NoteRange } from "./notes.types";

function rangeOf(selection: Selection): NoteRange {
  const reversed =
    selection.anchorRow > selection.headRow ||
    (selection.anchorRow === selection.headRow && selection.anchorColumn > selection.headColumn);

  if (!reversed) {
    return {
      startRow: selection.anchorRow,
      endRow: selection.headRow,
      pane: selection.pane,
      startColumn: selection.anchorColumn,
      endColumn: selection.headColumn + 1,
    };
  }

  return {
    startRow: selection.headRow,
    endRow: selection.anchorRow,
    pane: selection.pane,
    startColumn: selection.headColumn,
    endColumn: selection.anchorColumn + 1,
  };
}

export function noteFromSelection(
  model: DiffModel,
  selection: Selection,
  id: number,
  text: string,
): Note | null {
  const trimmed = text.trim();

  if (trimmed === "") {
    return null;
  }

  const range = rangeOf(selection);
  const startRow = model.rows[range.startRow];
  const endRow = model.rows[range.endRow];

  if (startRow === undefined || endRow === undefined) {
    return null;
  }

  const line = range.pane === "right" ? startRow.rightNumber : startRow.leftNumber;
  const endLine = range.pane === "right" ? endRow.rightNumber : endRow.leftNumber;
  const code = range.pane === "right" ? startRow.right : startRow.left;

  return {
    id,
    rowIndex: range.startRow,
    endRowIndex: range.endRow,
    pane: range.pane,
    startColumn: range.startColumn,
    endColumn: range.endColumn,
    line,
    endLine,
    code,
    text: trimmed,
  };
}

// A multi-row note covers the rest of its first line, whatever its end column on the last row.
function firstRowEndColumn(note: Note): number {
  return note.endRowIndex > note.rowIndex ? note.code.length : note.endColumn;
}

function isWholeLine(note: Note): boolean {
  return note.startColumn === 0 && firstRowEndColumn(note) >= note.code.length;
}

function withSpanSuffix(note: Note): string {
  const selected = note.code.slice(note.startColumn, firstRowEndColumn(note));

  return `${note.text} [re: "${selected}"]`;
}

export function toQuestions(notes: Note[]): Question[] {
  return notes.map((note) => ({
    line: note.line,
    code: note.code,
    text: isWholeLine(note) ? note.text : withSpanSuffix(note),
  }));
}

export function writeResult(path: string, notes: Note[]): void {
  try {
    writeFileSync(path, JSON.stringify({ questions: toQuestions(notes) }, null, 2), "utf-8");
  } catch {
    return;
  }
}
