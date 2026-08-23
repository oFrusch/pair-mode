import { writeFileSync } from "node:fs";
import type { Question } from "../../core/collect";
import type { DiffModel } from "../model";
import type { Selection } from "../selection/selection.types";
import type { FirstRow, Note } from "./notes.types";

function firstRowOf(selection: Selection): FirstRow {
  const reversed =
    selection.anchorRow > selection.headRow ||
    (selection.anchorRow === selection.headRow && selection.anchorColumn > selection.headColumn);

  const singleRow = selection.anchorRow === selection.headRow;

  if (!reversed) {
    return { row: selection.anchorRow, pane: selection.pane, startColumn: selection.anchorColumn, headColumn: selection.headColumn, singleRow };
  }

  return { row: selection.headRow, pane: selection.pane, startColumn: selection.headColumn, headColumn: selection.anchorColumn, singleRow };
}

export function noteFromSelection(model: DiffModel, selection: Selection, id: number, text: string): Note | null {
  const trimmed = text.trim();

  if (trimmed === "") {
    return null;
  }

  const first = firstRowOf(selection);
  const row = model.rows[first.row];

  if (row === undefined) {
    return null;
  }

  const line = first.pane === "right" ? row.rightNumber : row.leftNumber;
  const code = first.pane === "right" ? row.right : row.left;
  const endColumn = first.singleRow ? first.headColumn + 1 : code.length;

  return {
    id,
    rowIndex: first.row,
    pane: first.pane,
    startColumn: first.startColumn,
    endColumn,
    line,
    code,
    text: trimmed,
  };
}

function isWholeLine(note: Note): boolean {
  return note.startColumn === 0 && note.endColumn >= note.code.length;
}

function withSpanSuffix(note: Note): string {
  const selected = note.code.slice(note.startColumn, note.endColumn);

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
