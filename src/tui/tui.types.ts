import type { Question } from "../core/collect";
import type { DiffModel, ScreenMap } from "./model/model.types";

export type Mode = "browse" | "select" | "note" | "help" | "confirm";

export interface Selection {
  pane: "left" | "right";
  anchorRow: number;
  anchorColumn: number;
  headRow: number;
  headColumn: number;
}

export interface TuiState {
  model: DiffModel;
  mode: Mode;
  scrollTop: number;
  map: ScreenMap;
  layout: "split" | "unified";
  quit: "none" | "clean" | "send";
  selection: Selection | null;
}

export interface TuiOptions {
  before: string[];
  after: string[];
  path: string;
  context: number;
  minFold: number;
  layout: "split" | "unified";
  rowBand: boolean;
  width: number;
  height: number;
  truecolor: boolean;
}

export interface TuiIo {
  onKey(handler: (chunk: string) => void): void;
  write(text: string): void;
  size(): { width: number; height: number };
  cleanup(): void;
}

export interface TuiResult {
  quit: "clean" | "send";
  questions: Question[];
}
