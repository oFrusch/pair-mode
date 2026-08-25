import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { unlinkSync } from "node:fs";
import type { PairConfig } from "../../core/config";
import { findSessionSocket } from "../../core/state";
import type { EditRequest, ReviewOutcome, ReviewTransport } from "../transport.types";
import { createLineReader, decodeLine, encode } from "./wire";
import type { SessionClientOptions } from "./client.types";

const MS_PER_SECOND = 1000;

function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Best-effort cleanup only.
  }
}

function failOpen(detail: string): ReviewOutcome {
  return { reviewed: false, detail };
}

function isConnectionRefused(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }

  return error.code === "ECONNREFUSED" || error.code === "ENOENT" || error.code === "ENOTSOCK";
}

// The hook must never hang, so every failure path below resolves rather than rejects.
function requestReview(
  request: EditRequest,
  options: SessionClientOptions,
): Promise<ReviewOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let socket: Socket | null = null;

    const settle = (outcome: ReviewOutcome): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket?.destroy();
      resolve(outcome);
    };

    const timer = setTimeout(
      () => settle(failOpen(`no verdict within ${options.timeoutMs}ms`)),
      options.timeoutMs,
    );

    socket = createConnection(options.socketPath);
    socket.setEncoding("utf-8");

    const readLines = createLineReader();

    let lastError = "";

    // Any other error kills the socket, so close settles it. Settling here would race close and lose the reason.
    socket.on("error", (error: unknown) => {
      // A socket file whose watcher died refuses the connection, so the file is stale and goes.
      if (isConnectionRefused(error)) {
        removeQuietly(options.socketPath);
        settle(failOpen("no pair-mode watcher attached"));
        return;
      }

      lastError = error instanceof Error ? error.message : String(error);
    });

    socket.on("close", () => {
      const reason = lastError === "" ? "" : ` (${lastError})`;
      settle(failOpen(`the watcher closed before answering${reason}`));
    });

    socket.on("data", (chunk: string) => {
      readLines(chunk).forEach((line) => {
        const message = decodeLine(line);

        if (message?.type === "verdict") {
          settle({ reviewed: true, questions: message.questions });
        }
      });
    });

    socket.on("connect", () => {
      socket?.write(
        encode({
          type: "submit",
          tool: request.tool,
          path: request.filePath,
          before: request.before,
          after: request.after,
        }),
      );
    });
  });
}

function reviewInSession(
  request: EditRequest,
  config: PairConfig,
  socketPath?: string,
): Promise<ReviewOutcome> {
  const path = socketPath ?? findSessionSocket(request.filePath);

  if (path === null) {
    return Promise.resolve(failOpen("no pair-mode watcher attached"));
  }

  return requestReview(request, {
    socketPath: path,
    timeoutMs: config.session.timeout * MS_PER_SECOND,
  });
}

export function createSessionTransport(socketPath?: string): ReviewTransport {
  return {
    name: "session",

    review(request: EditRequest, config: PairConfig): Promise<ReviewOutcome> {
      return reviewInSession(request, config, socketPath);
    },
  };
}
