export { changedSpans, chooseLayout, layoutStatusMessage, MIN_SPLIT_WIDTH, noTokens, paint, SPAN_SIMILARITY_FLOOR } from "./paint";
export { paintSplit, paintUnified } from "./layout";
export { bg, fg, RESET, supportsTruecolor, theme } from "./theme";
export type {
  ChangedSpans,
  PaintOptions,
  PaintResult,
  Span,
  SyntaxToken,
  TokenProvider,
  TuiTheme,
} from "./paint.types";
