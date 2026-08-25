export interface WebNote {
  startRow: number;
  endRow: number;
  pane: "left" | "right";
  startColumn: number;
  endColumn: number;
  text: string;
}
