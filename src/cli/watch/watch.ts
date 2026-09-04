import { paintLayout } from "../../core/config";
import type { PairConfig } from "../../core/config";
import { buildSessionRecord, watchSocketPath } from "../../core/state";
import { removeQuietly, resultFilePath, splitLines } from "../../helpers";
import { ownerHost, probeSession, viewerHost } from "../../transports/session";
import type { SessionHost } from "../../transports/session";
import type { ReviewMessage } from "../../transports/session";
import { supportsTruecolor } from "../../tui/paint";
import { createTokenProvider } from "../../tui/syntax";
import { runTui } from "../../tui";
import type { TuiOptions } from "../../tui";
import { sweepDeadSessions } from "../sessions";
import { renderIdle } from "./idle";
import { createWatchIo } from "./io";
import type { IdleStatus, WatchIo, WatchOptions } from "./watch.types";

const CLEAR_SCREEN = "\x1b[2J\x1b[H";
const QUIT_KEYS = ["q", "\x03", "\x04"];

// The session errors are held until the alternate screen is gone, so nothing overwrites a frame the user is reading.
function reportErrors(errors: readonly Error[]): void {
  errors.forEach((error) => process.stderr.write(`pair-mode: ${error.message}\n`));
}

function paintIdle(io: WatchIo, status: IdleStatus, truecolor: boolean): void {
  const { width } = io.size();
  io.write(CLEAR_SCREEN + renderIdle(status, width, truecolor).join("\r\n") + "\r\n");
}

async function optionsFor(
  review: ReviewMessage,
  config: PairConfig,
  io: WatchIo,
  resultFile: string,
): Promise<TuiOptions> {
  const truecolor = supportsTruecolor(process.env);
  const { width, height } = io.size();

  const tokens = await createTokenProvider({
    path: review.path,
    enabled: config.syntax,
    truecolor,
  });

  return {
    before: splitLines(review.before),
    after: splitLines(review.after),
    path: review.path,
    context: config.context,
    minFold: config.minFold,
    layout: paintLayout(config.layout),
    notePosition: config.notes,
    rowBand: config.theme.rowBand,
    width,
    height,
    truecolor,
    resultFile,
    tokens,
  };
}

export async function runWatch(options: WatchOptions, config: PairConfig): Promise<number> {
  const socketPath = watchSocketPath(options.directory, options.sessionKey, options.socketPath);
  let errors: readonly Error[] = [];

  // Only a refused connect proves no watcher owns this socket, so anything else means this run is a second viewer.
  const owns = (await probeSession(socketPath)).status === "refused";

  // The TUI owns the screen for the whole run, so a session error waits for the screen to be released.
  const host: SessionHost = owns
    ? await ownerHost({
        socketPath,
        client: "tui",
        record: buildSessionRecord(options, socketPath),
        onError: (error) => {
          errors = [...errors, error];
        },
      })
    : await viewerHost({ socketPath, client: "tui" });

  // This socket is listening by now, so the sweep can only clear the sockets other watchers abandoned.
  await sweepDeadSessions();

  const truecolor = supportsTruecolor(process.env);
  const io = options.io ?? createWatchIo();

  const status = (): IdleStatus => {
    const counts = host.counts();
    return {
      directory: options.directory,
      socketPath,
      clients: counts.clients,
      waiting: counts.waiting,
    };
  };

  const pending: ReviewMessage[] = [];
  const cancelled = new Set<string>();
  const aborts = new Map<string, AbortController>();

  let busy = false;
  let quitting = false;
  let wake: (() => void) | null = null;

  const nudge = (): void => {
    const resume = wake;
    wake = null;
    resume?.();
  };

  // The idle screen and the TUI share one stdin, so the key handler is rebound each time control changes.
  const listenIdle = (): void => {
    io.onKey((chunk) => {
      if (QUIT_KEYS.includes(chunk)) {
        quitting = true;
        nudge();
      }
    });

    io.onResize(() => paintIdle(io, status(), truecolor));
  };

  host.onReview((review) => {
    pending.push(review);
    nudge();
  });

  host.onCancel((id) => {
    cancelled.add(id);
    aborts.get(id)?.abort();
    nudge();
  });

  host.onChange(() => {
    if (!busy && !quitting) {
      paintIdle(io, status(), truecolor);
    }
  });

  while (!quitting) {
    const review = pending.shift();

    if (review === undefined) {
      host.refreshCounts();
      listenIdle();
      paintIdle(io, status(), truecolor);
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      continue;
    }

    busy = true;
    const resultFile = resultFilePath();
    const abort = new AbortController();
    aborts.set(review.id, abort);

    try {
      const tuiOptions = await optionsFor(review, config, io, resultFile);
      const result = await runTui(tuiOptions, io, abort.signal);

      // A cancelled review has no hook left to answer, so the verdict goes nowhere.
      if (!cancelled.has(review.id)) {
        host.verdict(review.id, result.quit === "send" ? result.questions : []);
      }
    } finally {
      aborts.delete(review.id);
      cancelled.delete(review.id);
      removeQuietly(resultFile);
      busy = false;
    }
  }

  io.write(CLEAR_SCREEN);
  io.shutdown();

  // A viewer owns neither the socket nor the sidecar, so only the watcher that bound them takes them down.
  await host.close();

  reportErrors(errors);

  return 0;
}
