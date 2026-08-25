import { diffWordsWithSpace } from "diff";
import { paintSplit, paintUnified } from "./layout";
import type {
  ChangedSpans,
  LayoutDecision,
  PaintOptions,
  PaintResult,
  Span,
  TokenProvider,
} from "./paint.types";

export const SPAN_SIMILARITY_FLOOR = 0.3;
export const MIN_SPLIT_WIDTH = 90;

const NEW_FILE_REASON = "whole file is new · unified";
const NARROW_REASON = "narrow · unified";

export const noTokens: TokenProvider = () => [];

// Shared indent inflates the similarity fraction, so an otherwise-rewritten row keeps word-level spans.
function indentWidth(line: string): number {
  return line.length - line.trimStart().length;
}

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

  const indent = Math.min(indentWidth(before), indentWidth(after));
  const longer = Math.max(before.length, after.length) - indent;
  const sharedFraction = longer <= 0 ? 1 : (sharedLength - indent) / longer;

  if (sharedFraction < SPAN_SIMILARITY_FLOOR) {
    return {
      left: before === "" ? [] : [{ start: 0, end: before.length }],
      right: after === "" ? [] : [{ start: 0, end: after.length }],
    };
  }

  return { left, right };
}

function decideLayout(options: PaintOptions): LayoutDecision {
  const preferred = options.layout;
  const hasRemoval = options.model.rows.some((row) => row.kind === "del" || row.kind === "replace");

  const forcedReason = !hasRemoval
    ? NEW_FILE_REASON
    : options.width < MIN_SPLIT_WIDTH
      ? NARROW_REASON
      : null;

  if (forcedReason === null) {
    return { layout: preferred, overrideReason: null };
  }

  return { layout: "unified", overrideReason: preferred === "split" ? forcedReason : null };
}

export function chooseLayout(options: PaintOptions): "split" | "unified" {
  return decideLayout(options).layout;
}

export function layoutStatusMessage(options: PaintOptions): string | null {
  return decideLayout(options).overrideReason;
}

export function paint(options: PaintOptions): PaintResult {
  const { layout } = decideLayout(options);

  return layout === "unified" ? paintUnified(options) : paintSplit(options);
}
