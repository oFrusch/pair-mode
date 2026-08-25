import type { Pane, SpanRange } from "./markup.types";
import type { CellRef, RangeLike } from "./selection.types";

// A DOM range can start inside a colour span, so the offset comes from the text between the cell start and that point.
export function columnIn(
  range: RangeLike,
  cellNode: unknown,
  node: unknown,
  offset: number,
): number {
  range.selectNodeContents(cellNode);
  range.setEnd(node, offset);

  return range.toString().length;
}

function isPane(value: string | undefined): value is Pane {
  return value === "left" || value === "right";
}

function rowOf(cell: CellRef): number | null {
  const row = Number(cell.row);

  return Number.isInteger(row) && row >= 0 ? row : null;
}

// A selection that leaves the diff, or crosses panes, has no single side to anchor a note to.
export function draftRange(
  start: CellRef | null,
  end: CellRef | null,
  startColumn: number,
  endColumn: number,
): SpanRange | null {
  if (start === null || end === null || start.pane !== end.pane || !isPane(start.pane)) {
    return null;
  }

  const startRow = rowOf(start);
  const endRow = rowOf(end);

  if (startRow === null || endRow === null) {
    return null;
  }

  return { startRow, endRow, pane: start.pane, startColumn, endColumn };
}
