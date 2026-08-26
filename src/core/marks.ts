export const MARK_OLD = "▌▌- ";
export const MARK_NEW = "▌▌+ ";
export const MARK_SAME = "    ";
export const FOLD_PREFIX = "⋯ ";
export const DEFAULT_CONTEXT = 5;
export const DEFAULT_MIN_FOLD = 4;

const ROW_MARKS: string[] = [MARK_OLD, MARK_NEW, MARK_SAME];

// The pane column carries a row marker the agent must never see as source text.
export function stripMark(line: string): string {
  const mark = ROW_MARKS.find((candidate) => line.startsWith(candidate));

  return mark === undefined ? line : line.slice(mark.length);
}
