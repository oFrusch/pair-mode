import { align, fold } from "../diff";
import type { Row } from "../diff/types";
import type { RenderInput, RenderResult } from "./types";

const HEADER_LEAD: string[] = [
  "# PAIR MODE. Left pane is the current file. Right pane is the proposal.",
  "# Type questions on their own lines in the RIGHT pane. Add lines only.",
  "# Every line you add becomes a question anchored to the code above it.",
];

const HEADER_TAIL: string[] = ["#", "# tool: {tool}", "# file: {path}"];

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  const last = lines.at(-1);

  if (last === "") {
    lines.pop();
  }

  return lines;
}

function buildHeader(tool: string, path: string, headerHint: string[]): string[] {
  const lines = [...HEADER_LEAD, ...headerHint, ...HEADER_TAIL];
  return lines.map((line) => line.replace("{tool}", tool).replace("{path}", path));
}

export function renderSplit(input: RenderInput): RenderResult {
  const before = splitLines(input.before);
  const after = splitLines(input.after);
  const header = buildHeader(input.tool, input.path, input.headerHint);
  const rows = align(before, after);

  return fold(rows, header, input.context, input.minFold);
}

export function renderInline(input: RenderInput): RenderResult {
  const before = splitLines(input.before);
  const after = splitLines(input.after);
  const header = buildHeader(input.tool, input.path, input.headerHint);
  const rows = align(before, after);

  // Inline stacks both sides into one column, so each entry is a row whose panes are identical.
  const entries = rows.flatMap((row): Row[] => {
    if (!row.changed) {
      return [{ changed: false, left: row.left, right: row.left, number: row.number }];
    }

    const left =
      row.left !== "" ? [{ changed: true, left: row.left, right: row.left, number: null }] : [];
    const right =
      row.right !== ""
        ? [{ changed: true, left: row.right, right: row.right, number: row.number }]
        : [];

    return [...left, ...right];
  });

  const panes = fold(entries, header, input.context, input.minFold);

  return { left: panes.left, right: panes.left, numbers: panes.numbers };
}
