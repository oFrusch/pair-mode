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

  const headerNumbers: (number | null)[] = header.map(() => null);

  const entries = rows.flatMap((row): { line: string; number: number | null }[] => {
    if (!row.changed) {
      return [{ line: row.left, number: row.number }];
    }

    const left = row.left !== "" ? [{ line: row.left, number: null }] : [];
    const right = row.right !== "" ? [{ line: row.right, number: row.number }] : [];

    return [...left, ...right];
  });

  const lines = [...header, ...entries.map((entry) => entry.line)];
  const numbers = [...headerNumbers, ...entries.map((entry) => entry.number)];

  return { left: lines, right: lines, numbers };
}
