import type { FoldGroup, RowKind } from "../tui/model";
import type { SyntaxToken } from "../tui/paint";

export interface WebRow {
  kind: RowKind;
  left: string;
  right: string;
  leftNumber: number | null;
  rightNumber: number | null;
  leftTokens: SyntaxToken[];
  rightTokens: SyntaxToken[];
}

export interface WebReview {
  id: string;
  tool: string;
  path: string;
  rows: WebRow[];
  folds: FoldGroup[];
}
