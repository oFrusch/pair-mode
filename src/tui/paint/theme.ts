import { isHexColor } from "../../helpers/hexColor";
import type { AnsiPair, Rgb, TuiTheme } from "./paint.types";

const RED_CHANNEL_START = 1;
const GREEN_CHANNEL_START = 3;
const BLUE_CHANNEL_START = 5;
const CHANNEL_END = 7;
const HEX_RADIX = 16;

export const theme: TuiTheme = Object.freeze({
  addBar: "#3FB950",
  addSpan: "#1F5B2E",
  delBar: "#F85149",
  delSpan: "#6B2126",
  selection: "#16324F",
  note: "#D2A8FF",
  fold: "#6E7681",
  chrome: "#E8A33D",
  statusText: "#1F1A12",
});

export const RESET = "\x1b[0m";

export const DEFAULT_FG = "\x1b[39m";
export const DEFAULT_BG = "\x1b[49m";

const ANSI_16: Record<string, AnsiPair> = {
  [theme.addBar]: { fg: "\x1b[32m", bg: "\x1b[42m" },
  [theme.addSpan]: { fg: "\x1b[32m", bg: "\x1b[42m" },
  [theme.delBar]: { fg: "\x1b[31m", bg: "\x1b[41m" },
  [theme.delSpan]: { fg: "\x1b[31m", bg: "\x1b[41m" },
  [theme.selection]: { fg: "\x1b[34m", bg: "\x1b[44m" },
  [theme.note]: { fg: "\x1b[35m", bg: "\x1b[45m" },
  [theme.fold]: { fg: "\x1b[90m", bg: "\x1b[100m" },
  [theme.chrome]: { fg: "\x1b[33m", bg: "\x1b[43m" },
  [theme.statusText]: { fg: "\x1b[30m", bg: "\x1b[40m" },
};

export function supportsTruecolor(env: Record<string, string | undefined>): boolean {
  return env.COLORTERM === "truecolor" || env.COLORTERM === "24bit";
}

function hexToRgb(hex: string): Rgb | null {
  if (!isHexColor(hex)) {
    return null;
  }

  return {
    r: parseInt(hex.slice(RED_CHANNEL_START, GREEN_CHANNEL_START), HEX_RADIX),
    g: parseInt(hex.slice(GREEN_CHANNEL_START, BLUE_CHANNEL_START), HEX_RADIX),
    b: parseInt(hex.slice(BLUE_CHANNEL_START, CHANNEL_END), HEX_RADIX),
  };
}

export function fg(hex: string, truecolor: boolean): string {
  const rgb = hexToRgb(hex);

  if (rgb === null) {
    return DEFAULT_FG;
  }

  if (truecolor) {
    return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`;
  }

  const mapped = ANSI_16[hex];

  return mapped === undefined ? DEFAULT_FG : mapped.fg;
}

export function bg(hex: string, truecolor: boolean): string {
  const rgb = hexToRgb(hex);

  if (rgb === null) {
    return DEFAULT_BG;
  }

  if (truecolor) {
    return `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m`;
  }

  const mapped = ANSI_16[hex];

  return mapped === undefined ? DEFAULT_BG : mapped.bg;
}
