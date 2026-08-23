import { applyKey, bodyHeight, frameDiff, runTui } from "./tui";
import type { TuiIo, TuiOptions, TuiResult, TuiState } from "./tui.types";

const DEFAULT_WIDTH = 80;
const DEFAULT_HEIGHT = 24;

export function createStdioIo(): TuiIo {
  const wasRaw = process.stdin.isRaw === true;

  process.stdin.setEncoding("utf8");

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.resume();

  return {
    onKey(handler) {
      process.stdin.on("data", (chunk) => {
        handler(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      });
    },
    write(text) {
      process.stdout.write(text);
    },
    size() {
      return {
        width: process.stdout.columns ?? DEFAULT_WIDTH,
        height: process.stdout.rows ?? DEFAULT_HEIGHT,
      };
    },
    cleanup() {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(wasRaw);
      }

      process.stdin.pause();
    },
  };
}

export { applyKey, bodyHeight, frameDiff, runTui };
export type { TuiIo, TuiOptions, TuiResult, TuiState };
