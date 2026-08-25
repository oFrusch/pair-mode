import { readFileSync } from "node:fs";
import { isEntryPoint } from "../adapters/entry-point";
import { resultFilePath, splitLines } from "../helpers";
import { DEFAULT_CONTEXT, DEFAULT_MIN_FOLD } from "../core/marks";
import { supportsTruecolor } from "./paint";
import type { NotePosition } from "./paint";
import { createTokenProvider } from "./syntax";
import { createStdioIo, runTui } from "./index";
import type { TuiOptions } from "./tui.types";

const DEFAULT_TERMINAL_WIDTH = 80;
const DEFAULT_TERMINAL_HEIGHT = 24;
const DEFAULT_LAYOUT: TuiOptions["layout"] = "split";
const DEFAULT_NOTE_POSITION: NotePosition = "panel";
const UNIFIED_LAYOUT_FLAG = "unified";
const ANCHORED_NOTES_FLAG = "anchored";
const TRUE_FLAG_VALUE = "true";
const FALSE_FLAG_VALUE = "false";

function readLinesOf(path: string | undefined): string[] {
  if (path === undefined) {
    return [];
  }

  try {
    return splitLines(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

// A bare flag name (no following value) is malformed, so it is left out and the caller's default applies.
function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};

  argv.forEach((entry, index) => {
    if (!entry.startsWith("--")) {
      return;
    }

    const value = argv[index + 1];

    if (value === undefined || value.startsWith("--")) {
      return;
    }

    args[entry.slice(2)] = value;
  });

  return args;
}

function toLayout(value: string | undefined): TuiOptions["layout"] {
  return value === UNIFIED_LAYOUT_FLAG ? "unified" : DEFAULT_LAYOUT;
}

function toNotePosition(value: string | undefined): NotePosition {
  return value === ANCHORED_NOTES_FLAG ? "anchored" : DEFAULT_NOTE_POSITION;
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === TRUE_FLAG_VALUE) {
    return true;
  }

  if (value === FALSE_FLAG_VALUE) {
    return false;
  }

  return fallback;
}

// A missing, non-numeric, or non-positive value falls back to the caller's default rather than reaching the model as NaN or zero.
export function toPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function readTerminalSize(stdout: NodeJS.WriteStream): { width: number; height: number } {
  return {
    width: stdout.columns ?? DEFAULT_TERMINAL_WIDTH,
    height: stdout.rows ?? DEFAULT_TERMINAL_HEIGHT,
  };
}

async function run(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  const before = readLinesOf(args["left"]);
  const after = readLinesOf(args["right"]);
  const path = args["path"] ?? "";
  const layout = toLayout(args["layout"]);
  const notePosition = toNotePosition(args["notes"]);
  const rowBand = toBoolean(args["row-band"], true);
  const syntaxEnabled = toBoolean(args["syntax"], true);
  const context = toPositiveInteger(args["context"], DEFAULT_CONTEXT);
  const minFold = toPositiveInteger(args["min-fold"], DEFAULT_MIN_FOLD);
  const resultFile = args["result"] ?? resultFilePath();
  const truecolor = supportsTruecolor(process.env);
  const { width, height } = readTerminalSize(process.stdout);

  const tokens = await createTokenProvider({ path, enabled: syntaxEnabled, truecolor });

  const options: TuiOptions = {
    before,
    after,
    path,
    context,
    minFold,
    layout,
    notePosition,
    rowBand,
    width,
    height,
    truecolor,
    resultFile,
    tokens,
  };

  // TuiResult.quit is "clean" | "send" only. runPair reads the result file, not this exit code, so both quit paths exit 0.
  await runTui(options, createStdioIo());

  return 0;
}

// runTui already restores the screen and raw mode before it rejects, so a caught failure here only needs to report and exit.
async function main(): Promise<number> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`pair-mode tui: ${message}\n`);
    return 1;
  }
}

// Only runs the TUI when this file is the process entry point, not when a test imports its helpers.
if (isEntryPoint(import.meta.url)) {
  const code = await main();
  process.exit(code);
}
