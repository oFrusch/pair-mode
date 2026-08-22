import { align, fold } from "./diff";
import type { RenderInput, RenderResult } from "./render.types";

export const HEADER_SPLIT: string[] = [
  "# PAIR MODE. Left pane is the current file. Right pane is the proposal.",
  "# Type questions on their own lines in the RIGHT pane. Add lines only.",
  "# Every line you add becomes a question anchored to the code above it.",
  "# F3 moves between panes. Ctrl+W or F2 sends and closes.",
  "#",
  "# tool: {tool}",
  "# file: {path}",
];

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  const last = lines.at(-1);

  if (last === "") {
    lines.pop();
  }

  return lines;
}

function buildHeader(tool: string, path: string): string[] {
  return HEADER_SPLIT.map((line) => line.replace("{tool}", tool).replace("{path}", path));
}

export function renderSplit(input: RenderInput): RenderResult {
  const before = splitLines(input.before);
  const after = splitLines(input.after);
  const header = buildHeader(input.tool, input.path);
  const rows = align(before, after);

  return fold(rows, header, input.context, input.minFold);
}

export function renderInline(input: RenderInput): RenderResult {
  const before = splitLines(input.before);
  const after = splitLines(input.after);
  const header = buildHeader(input.tool, input.path);
  const rows = align(before, after);

  const lines = [...header];
  const numbers: (number | null)[] = header.map(() => null);

  for (const row of rows) {
    if (!row.changed) {
      lines.push(row.left);
      numbers.push(row.number);
      continue;
    }

    if (row.left !== "") {
      lines.push(row.left);
      numbers.push(null);
    }

    if (row.right !== "") {
      lines.push(row.right);
      numbers.push(row.number);
    }
  }

  return { left: lines, right: lines, numbers };
}
