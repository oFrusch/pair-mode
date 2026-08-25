import { bg, fg, theme, RESET } from "../../tui/paint";
import type { IdleStatus } from "./watch.types";

const TITLE = "pair-mode watch";
const HINT = "waiting for an edit · q quits";
const LABEL_WIDTH = 10;

function line(label: string, value: string, truecolor: boolean): string {
  return fg(theme.fold, truecolor) + label.padEnd(LABEL_WIDTH) + RESET + value;
}

function plural(count: number, word: string): string {
  return count === 1 ? `1 ${word}` : `${count} ${word}s`;
}

// A queue depth of zero reads better as a word than as a bare number on an idle screen.
function queueText(waiting: number): string {
  return waiting === 0 ? "empty" : plural(waiting, "review");
}

export function renderIdle(status: IdleStatus, width: number, truecolor: boolean): string[] {
  const heading =
    bg(theme.chrome, truecolor) +
    fg(theme.statusText, truecolor) +
    TITLE.padEnd(width).slice(0, width) +
    RESET;

  return [
    heading,
    "",
    line("session", status.directory, truecolor),
    line("socket", status.socketPath, truecolor),
    line("clients", plural(status.clients, "client"), truecolor),
    line("queue", queueText(status.waiting), truecolor),
    "",
    fg(theme.fold, truecolor) + HINT + RESET,
  ];
}
