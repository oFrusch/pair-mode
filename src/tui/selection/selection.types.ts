export interface Selection {
  pane: "left" | "right";
  anchorRow: number;
  anchorColumn: number;
  headRow: number;
  headColumn: number;
}
