import { diffWordsWithSpace } from "diff";
import { paintSplit } from "./layout";
import type { ChangedSpans, PaintOptions, PaintResult, Span, TokenProvider } from "./paint.types";

export const SPAN_SIMILARITY_FLOOR = 0.3;

export const noTokens: TokenProvider = () => [];

export function changedSpans(before: string, after: string): ChangedSpans {
  const chunks = diffWordsWithSpace(before, after);

  let leftCursor = 0;
  let rightCursor = 0;
  let sharedLength = 0;
  const left: Span[] = [];
  const right: Span[] = [];

  chunks.forEach((chunk) => {
    const length = chunk.value.length;

    if (chunk.removed === true) {
      left.push({ start: leftCursor, end: leftCursor + length });
      leftCursor += length;
      return;
    }

    if (chunk.added === true) {
      right.push({ start: rightCursor, end: rightCursor + length });
      rightCursor += length;
      return;
    }

    sharedLength += length;
    leftCursor += length;
    rightCursor += length;
  });

  const longer = Math.max(before.length, after.length);
  const sharedFraction = longer === 0 ? 1 : sharedLength / longer;

  if (sharedFraction < SPAN_SIMILARITY_FLOOR) {
    return {
      left: before === "" ? [] : [{ start: 0, end: before.length }],
      right: after === "" ? [] : [{ start: 0, end: after.length }],
    };
  }

  return { left, right };
}

export function paint(options: PaintOptions): PaintResult {
  return paintSplit(options);
}
