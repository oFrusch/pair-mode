import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { paintLayout } from "../../core/config";
import type { PairConfig } from "../../core/config";
import { buildSessionRecord, sessionKeySocketPath, sessionSocketPath } from "../../core/state";
import { removeQuietly, resultFilePath, splitLines } from "../../helpers";
import { startSessionServer } from "../../transports/session";
import type { SessionServer } from "../../transports/session";
import { createLineReader, decodeLine, encode } from "../../transports/session";
import type { ReviewMessage, StateMessage } from "../../transports/session";
import { supportsTruecolor } from "../../tui/paint";
import { createTokenProvider } from "../../tui/syntax";
import { runTui } from "../../tui";
import type { TuiOptions } from "../../tui";
import { probeSession, sweepDeadSessions } from "../sessions";
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

function connectSelf(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.setEncoding("utf-8");
    socket.once("error", reject);
    socket.once("connect", () => resolve(socket));
  });
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
  const socketPath =
    options.socketPath ??
    (options.sessionKey === undefined
      ? sessionSocketPath(options.directory)
      : sessionKeySocketPath(options.sessionKey));
  let errors: readonly Error[] = [];

  // Only a refused connect proves no watcher owns this socket, so anything else means this run is a second viewer.
  const owns = (await probeSession(socketPath)).status === "refused";

  // The TUI owns the screen for the whole run, so a session error waits for the screen to be released.
  const server: SessionServer | null = owns
    ? await startSessionServer({
        socketPath,
        record: buildSessionRecord(options, socketPath),
        onError: (error) => {
          errors = [...errors, error];
        },
      })
    : null;

  // This socket is listening by now, so the sweep can only clear the sockets other watchers abandoned.
  await sweepDeadSessions();

  const truecolor = supportsTruecolor(process.env);
  const io = options.io ?? createWatchIo();

  // A viewer holds no queue of its own, so it renders the counts the owner reports over the wire.
  let remote: StateMessage | null = null;

  const status = (): IdleStatus => ({
    directory: options.directory,
    socketPath,
    clients: server === null ? (remote?.clientCount ?? 0) : server.clientCount(),
    waiting: server === null ? (remote?.waitingDepth ?? 0) : server.waitingDepth(),
  });

  const client = await connectSelf(socketPath);
  const readLines = createLineReader();
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

  client.on("data", (chunk: string) => {
    readLines(chunk).forEach((line) => {
      const message = decodeLine(line);

      if (message?.type === "review") {
        pending.push(message);
        nudge();
        return;
      }

      if (message?.type === "cancel") {
        cancelled.add(message.id);
        aborts.get(message.id)?.abort();
        nudge();
        return;
      }

      if (message?.type === "state") {
        remote = message;

        if (!busy && !quitting) {
          paintIdle(io, status(), truecolor);
        }
      }
    });
  });

  server?.onChange(() => {
    if (!busy && !quitting) {
      paintIdle(io, status(), truecolor);
    }
  });

  client.write(encode({ type: "attach", client: "tui" }));

  while (!quitting) {
    const review = pending.shift();

    if (review === undefined) {
      if (server === null) {
        client.write(encode({ type: "status" }));
      }

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
        const questions = result.quit === "send" ? result.questions : [];
        client.write(encode({ type: "verdict", id: review.id, questions }));
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
  client.destroy();

  // A viewer owns neither the socket nor the sidecar, so only the watcher that bound them takes them down.
  await server?.close();

  reportErrors(errors);

  return 0;
}
