import type { MouseEvent } from "./input.types";

export const MOUSE_ON = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
export const MOUSE_OFF = "\x1b[?1006l\x1b[?1002l\x1b[?1000l";

const MOUSE_REPORT_SOURCE = "\\x1b\\[<(\\d+);(\\d+);(\\d+)([Mm])";
const BUTTON_MASK = 3;
const DRAG_BIT = 32;
const SCROLL_BIT = 64;
const SHIFT_BIT = 4;

function mouseReportPattern(): RegExp {
  return new RegExp(MOUSE_REPORT_SOURCE, "g");
}

function toMouseEvent(match: RegExpExecArray): MouseEvent {
  const word = Number(match[1]);
  const column = Number(match[2]);
  const row = Number(match[3]);
  const isRelease = match[4] === "m";

  const kind: MouseEvent["kind"] = isRelease
    ? "up"
    : (word & SCROLL_BIT) !== 0
      ? "scroll"
      : (word & DRAG_BIT) !== 0
        ? "drag"
        : "down";

  return {
    kind,
    button: word & BUTTON_MASK,
    row,
    column,
    shift: (word & SHIFT_BIT) !== 0,
  };
}

export function parseMouse(chunk: string): MouseEvent[] {
  return [...chunk.matchAll(mouseReportPattern())].map(toMouseEvent);
}

export function splitInput(chunk: string): { keys: string; mouse: MouseEvent[] } {
  const matches = [...chunk.matchAll(mouseReportPattern())];

  // Each key segment starts where the previous mouse report ended, and the last one runs to the end.
  const segmentStarts = [0, ...matches.map((match) => match.index + match[0].length)];

  const keys = segmentStarts
    .map((start, position) => chunk.slice(start, matches[position]?.index))
    .join("");

  return { keys, mouse: matches.map(toMouseEvent) };
}
