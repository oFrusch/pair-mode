export type RowKind = "context" | "add" | "del" | "replace";

export interface ModelRow {
  kind: RowKind;
  left: string;
  right: string;
  leftNumber: number | null;
  rightNumber: number | null;
}

export interface FoldGroup {
  start: number;
  count: number;
  expanded: boolean;
}

export interface DiffModel {
  rows: ModelRow[];
  folds: FoldGroup[];
  cursor: number;
}

export type VisibleRow = { kind: "row"; index: number } | { kind: "fold"; foldIndex: number };

export type ScreenRowKind = "chrome" | "row" | "fold";

export interface ScreenRow {
  kind: ScreenRowKind;
  index: number | null;
}

export interface PaneBounds {
  pane: "left" | "right";
  gutterStart: number;
  textStart: number;
  textEnd: number;
}

export interface ScreenMap {
  rows: ScreenRow[];
  panes: PaneBounds[];
}

export type ClickTarget =
  | { kind: "row"; index: number; pane: "left" | "right"; column: number }
  | { kind: "fold"; foldIndex: number };
