import type { Hunk } from "./types";

const identity = (line: string): string => line;
const trimTrailing = (line: string): string => line.replace(/\s+$/, "");
const trimBoth = (line: string): string => line.trim();

// Finds a run of `target.length` lines at index >= from whose normalized text matches target.
function findRun(
  lines: string[],
  target: string[],
  from: number,
  normalize: (line: string) => string,
): number {
  const wanted = target.map(normalize);

  for (let i = from; i + target.length <= lines.length; i++) {
    let matches = true;

    for (let offset = 0; offset < wanted.length; offset++) {
      if (normalize(lines[i + offset] ?? "") !== wanted[offset]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return i;
    }
  }

  return -1;
}

// Exact match first, then trailing-whitespace-trimmed, then fully trimmed, as a patch generator may reflow whitespace.
function findOldRun(lines: string[], oldLines: string[], from: number): number {
  const exact = findRun(lines, oldLines, from, identity);
  if (exact !== -1) return exact;

  const trailingTrimmed = findRun(lines, oldLines, from, trimTrailing);
  if (trailingTrimmed !== -1) return trailingTrimmed;

  return findRun(lines, oldLines, from, trimBoth);
}

// Finds the first line equal to ctx at index >= cursor; unmatched context means the patch no longer applies here.
function findContext(lines: string[], ctx: string, cursor: number): number {
  for (let i = cursor; i < lines.length; i++) {
    if (lines[i] === ctx) {
      return i;
    }
  }

  return -1;
}

// Applies each hunk in order against a cursor, so identical hunks land at their own occurrence instead of the first.
export function applyHunks(text: string, hunks: Hunk[]): string | null {
  let lines = text.split("\n");
  let cursor = 0;

  for (const hunk of hunks) {
    if (hunk.context !== null) {
      const contextIndex = findContext(lines, hunk.context, cursor);

      if (contextIndex === -1) {
        return null;
      }

      cursor = contextIndex + 1;
    }

    const oldLines = hunk.lines.flatMap((line) => (line.old !== null ? [line.old] : []));
    const newLines = hunk.lines.flatMap((line) => (line.new !== null ? [line.new] : []));

    // A hunk with no context or removed line has no anchor, so its position is a guess.
    if (oldLines.length === 0) {
      return null;
    }

    const matchIndex = findOldRun(lines, oldLines, cursor);

    if (matchIndex === -1) {
      return null;
    }

    lines = [
      ...lines.slice(0, matchIndex),
      ...newLines,
      ...lines.slice(matchIndex + oldLines.length),
    ];
    cursor = matchIndex + newLines.length;
  }

  return lines.join("\n");
}
