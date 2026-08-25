import type { Question } from "../core/collect";
import type { DiffModel, ScreenMap } from "./model/model.types";
import type { Note } from "./notes/notes.types";
import type { NotePosition, TokenProvider } from "./paint/paint.types";
import type { Selection } from "./selection/selection.types";

export type Mode = "browse" | "select" | "note" | "help" | "confirm";

export interface TuiState {
  model: DiffModel;
  mode: Mode;
  scrollTop: number;
  map: ScreenMap;
  layout: "split" | "unified";
  quit: "none" | "clean" | "send";
  selection: Selection | null;
  notes: Note[];
  focusedNote: number | null;
  draft: string;
  nextNoteId: number;
  notePosition: NotePosition;
}

export interface TuiOptions {
  before: string[];
  after: string[];
  path: string;
  context: number;
  minFold: number;
  layout: "split" | "unified";
  notePosition: NotePosition;
  rowBand: boolean;
  width: number;
  height: number;
  truecolor: boolean;
  resultFile: string;
  tokens: TokenProvider;
}

export interface TuiIo {
  onKey(handler: (chunk: string) => void): void;
  onResize?(handler: () => void): void;
  write(text: string): void;
  size(): { width: number; height: number };
  cleanup(): void;
}

export interface TuiResult {
  quit: "clean" | "send";
  questions: Question[];
}
