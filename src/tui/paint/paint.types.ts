import type { DiffModel, ScreenMap, ScreenRow } from "../model/model.types";
import type { Note } from "../notes/notes.types";
import type { Selection } from "../selection/selection.types";
import type { Mode } from "../tui.types";

export interface TuiTheme {
  addBar: string;
  addSpan: string;
  delBar: string;
  delSpan: string;
  selection: string;
  note: string;
  fold: string;
  chrome: string;
  statusText: string;
}

export interface Span {
  start: number;
  end: number;
}

export interface SpanScan {
  left: Span[];
  right: Span[];
  sharedLength: number;
  leftCursor: number;
  rightCursor: number;
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

export type NotePosition = "panel" | "anchored";

export interface PaintOptions {
  model: DiffModel;
  width: number;
  height: number;
  path: string;
  tokens: TokenProvider;
  truecolor: boolean;
  rowBand: boolean;
  scrollTop: number;
  layout: "split" | "unified";
  selection: Selection | null;
  mode: Mode;
  draft: string;
  notes: Note[];
  focusedNote: number | null;
  notePosition: NotePosition;
}

export interface PaintResult {
  lines: string[];
  map: ScreenMap;
  lastRow: number;
}

// Scroll and cursor arithmetic needs the geometry alone, so it asks for no token provider and no colours.
export interface ScrollGeometry {
  model: DiffModel;
  layout: "split" | "unified";
  width: number;
  height: number;
  notes: Note[];
  mode: Mode;
  notePosition: NotePosition;
  selection: Selection | null;
}

export interface ChangeCounts {
  add: number;
  del: number;
}

export interface BodyFill {
  lines: string[];
  screenRows: ScreenRow[];
  count: number;
}

export interface AnsiPair {
  fg: string;
  bg: string;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface SignBarStyle {
  leftChar: string;
  leftColor: string | null;
  rightChar: string;
  rightColor: string | null;
}

export type UnifiedHalfKind = "context" | "add" | "del";

export interface UnifiedBarStyle {
  char: string;
  color: string | null;
}

export interface UnifiedBodyEntry {
  lines: string[];
  screenRows: ScreenRow[];
}

export interface LayoutDecision {
  layout: "split" | "unified";
  overrideReason: string | null;
}
