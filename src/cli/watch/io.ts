import type { WatchIo } from "./watch.types";

const DEFAULT_WIDTH = 80;
const DEFAULT_HEIGHT = 24;

// One watcher process runs many reviews, so stdin is claimed once and every runTui call reuses this IO.
export function createWatchIo(): WatchIo {
  const wasRaw = process.stdin.isRaw === true;
  let keyHandler: ((chunk: string) => void) | null = null;
  let resizeHandler: (() => void) | null = null;

  process.stdin.setEncoding("utf8");

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.resume();

  process.stdin.on("data", (chunk) => {
    keyHandler?.(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  });

  process.stdout.on("resize", () => resizeHandler?.());

  return {
    onKey(handler) {
      keyHandler = handler;
    },

    onResize(handler) {
      resizeHandler = handler;
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

    // runTui tears down after every review, so the real restore waits for shutdown.
    cleanup() {
      keyHandler = null;
      resizeHandler = null;
    },

    shutdown() {
      keyHandler = null;
      resizeHandler = null;

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(wasRaw);
      }

      process.stdin.pause();
    },
  };
}
