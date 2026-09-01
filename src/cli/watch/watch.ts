import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { paintLayout } from "../../core/config";
import type { PairConfig } from "../../core/config";
import { sessionKeySocketPath, sessionSocketPath } from "../../core/state";
import type { SessionKind, SessionRecord } from "../../core/state";
import { removeQuietly, resultFilePath, splitLines } from "../../helpers";
import { startSessionServer } from "../../transports/session";
import { createLineReader, decodeLine, encode } from "../../transports/session";
import type { ReviewMessage } from "../../transports/session";
import { supportsTruecolor } from "../../tui/paint";
import { createTokenProvider } from "../../tui/syntax";
import { runTui } from "../../tui";
import type { TuiOptions } from "../../tui";
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

function currentBranch(directory: string): string | null {
  const result = spawnSync("git", ["-C", directory, "rev-parse", "--abbrev-ref", "HEAD"], {
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    return null;
  }

  const branch = result.stdout.trim();
  return branch === "" ? null : branch;
}

// A person reads the label, not the id, so it names the checkout and the branch.
function sessionLabel(directory: string, branch: string | null): string {
  const name = basename(directory);
  return branch === null ? name : `${name}@${branch}`;
}

function buildRecord(options: WatchOptions, socketPath: string): SessionRecord {
  const branch = currentBranch(options.directory);
  const kind: SessionKind = options.sessionKey === undefined ? "directory" : "session";

  return {
    id: options.sessionKey ?? basename(socketPath, ".sock"),
    kind,
    label: sessionLabel(options.directory, branch),
    directory: options.directory,
    branch,
    agentSessionId: options.agentSessionId ?? null,
    agentKind: options.agentKind ?? null,
    createdAt: new Date().toISOString(),
    pid: process.pid,
  };
}

export async function runWatch(options: WatchOptions, config: PairConfig): Promise<number> {
  const socketPath =
    options.socketPath ??
    (options.sessionKey === undefined
      ? sessionSocketPath(options.directory)
      : sessionKeySocketPath(options.sessionKey));
  let errors: readonly Error[] = [];

  // The TUI owns the screen for the whole run, so a session error waits for the screen to be released.
  const server = await startSessionServer({
    socketPath,
    record: buildRecord(options, socketPath),
    onError: (error) => {
      errors = [...errors, error];
    },
  });

  const truecolor = supportsTruecolor(process.env);
  const io = options.io ?? createWatchIo();

  const status = (): IdleStatus => ({
    directory: options.directory,
    socketPath,
    clients: server.clientCount(),
    waiting: server.waitingDepth(),
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
      }
    });
  });

  server.onChange(() => {
    if (!busy && !quitting) {
      paintIdle(io, status(), truecolor);
    }
  });

  client.write(encode({ type: "attach", client: "tui" }));

  while (!quitting) {
    const review = pending.shift();

    if (review === undefined) {
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
  await server.close();

  reportErrors(errors);

  return 0;
}
