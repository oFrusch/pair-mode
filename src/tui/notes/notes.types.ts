export interface Note {
  id: number;
  rowIndex: number;
  endRowIndex: number;
  pane: "left" | "right";
  startColumn: number;
  endColumn: number;
  line: number | null;
  endLine: number | null;
  code: string;
  text: string;
}

export interface NoteRange {
  startRow: number;
  endRow: number;
  pane: "left" | "right";
  startColumn: number;
  endColumn: number;
}
