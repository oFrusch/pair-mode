export {
  escapeHtml,
  hiddenRows,
  inlineHtml,
  labelOf,
  marginNotesHtml,
  markRange,
  marksFor,
  numberOf,
  paintCell,
  quoteOf,
  sortedNotes,
  tableHtml,
  textOf,
} from "./markup";

export { columnIn, draftRange } from "./selection";

export type { MarkRange, Pane, SpanRange } from "./markup.types";
export type { CellRef, RangeLike } from "./selection.types";
