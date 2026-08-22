import { align, fold } from "./diff";
import type { RenderInput, RenderResult } from "./render.types";

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
