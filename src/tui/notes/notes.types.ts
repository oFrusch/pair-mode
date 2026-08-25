export interface Note {
  id: number;
  rowIndex: number;
  pane: "left" | "right";
  startColumn: number;
  endColumn: number;
  line: number | null;
  code: string;
  text: string;
}

export interface FirstRow {
  row: number;
  pane: "left" | "right";
  startColumn: number;
  headColumn: number;
  singleRow: boolean;
}
