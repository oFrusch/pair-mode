import type { DiffModel, ScreenMap } from "../model/model.types";

export interface TuiTheme {
  addBar: string;
  addSpan: string;
  delBar: string;
  delSpan: string;
  selection: string;
  note: string;
  fold: string;
  chrome: string;
}

export interface Span {
  start: number;
  end: number;
}

export interface ChangedSpans {
  left: Span[];
  right: Span[];
}

export interface SyntaxToken {
  start: number;
  end: number;
  color: string;
}

export type TokenProvider = (line: string, lineNumber: number | null) => SyntaxToken[];

export interface PaintOptions {
  model: DiffModel;
  width: number;
  height: number;
  path: string;
  tokens: TokenProvider;
  truecolor: boolean;
  rowBand: boolean;
  scrollTop: number;
}

export interface PaintResult {
  lines: string[];
  map: ScreenMap;
}
