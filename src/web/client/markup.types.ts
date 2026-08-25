export type Pane = "left" | "right";

export interface MarkRange {
  start: number;
  end: number;
}

// The popup draft and a saved note share their geometry, so one shape serves the quote and the label.
export interface SpanRange {
  startRow: number;
  endRow: number;
  pane: Pane;
  startColumn: number;
  endColumn: number;
}
