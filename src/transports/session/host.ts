import { createConnection } from "node:net";
import type { Socket } from "node:net";
import type { Question } from "../../core/collect";
import { startSessionServer } from "./server";
import type { SessionServer } from "./server.types";
import { createLineReader, decodeLine, encode } from "./wire";
import type { ClientKind, ReviewMessage, StateMessage } from "./wire.types";
import type { HostCounts, SessionHost, SessionHostOptions } from "./host.types";

interface Handlers {
  review: Array<(review: ReviewMessage) => void>;
  cancel: Array<(id: string) => void>;
  change: Array<() => void>;
  bufferedReviews: ReviewMessage[];
  bufferedCancels: string[];
}

function connect(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.setEncoding("utf-8");
    socket.once("error", reject);
    socket.once("connect", () => resolve(socket));
  });
}

function emptyHandlers(): Handlers {
  return { review: [], cancel: [], change: [], bufferedReviews: [], bufferedCancels: [] };
}

// The server sends an outstanding review the moment a client attaches, so it waits here until a handler exists.
function addReviewHandler(handlers: Handlers, handler: (review: ReviewMessage) => void): void {
  handlers.review.push(handler);
  handlers.bufferedReviews.splice(0).forEach((review) => handler(review));
}

function addCancelHandler(handlers: Handlers, handler: (id: string) => void): void {
  handlers.cancel.push(handler);
  handlers.bufferedCancels.splice(0).forEach((id) => handler(id));
}

// The watcher attaches to its own socket as an ordinary client, so the owner and the viewer read the same stream.
async function attach(
  socketPath: string,
  client: ClientKind,
  handlers: Handlers,
  onState: (state: StateMessage) => void,
): Promise<Socket> {
  const socket = await connect(socketPath);
  const readLines = createLineReader();

  socket.on("data", (chunk: string) => {
    readLines(chunk).forEach((line) => {
      const message = decodeLine(line);

      if (message?.type === "review") {
        if (handlers.review.length === 0) {
          handlers.bufferedReviews.push(message);
          return;
        }

        handlers.review.forEach((handler) => handler(message));
        return;
      }

      if (message?.type === "cancel") {
        if (handlers.cancel.length === 0) {
          handlers.bufferedCancels.push(message.id);
          return;
        }

        handlers.cancel.forEach((handler) => handler(message.id));
        return;
      }

      if (message?.type === "state") {
        onState(message);
      }
    });
  });

  socket.write(encode({ type: "attach", client }));

  return socket;
}

// This watcher bound the socket, so it reads its own queue depth rather than asking over the wire.
export async function ownerHost(options: SessionHostOptions): Promise<SessionHost> {
  const handlers = emptyHandlers();

  const server: SessionServer = await startSessionServer({
    socketPath: options.socketPath,
    record: options.record,
    onError: options.onError,
  });

  server.onChange(() => handlers.change.forEach((handler) => handler()));

  const socket = await attach(options.socketPath, options.client, handlers, () => {});

  return {
    socketPath: options.socketPath,
    owns: true,

    counts(): HostCounts {
      return { clients: server.clientCount(), waiting: server.waitingDepth() };
    },

    // The server holds the counts in process, so nothing needs asking.
    refreshCounts(): void {},

    verdict(id: string, questions: Question[]): void {
      socket.write(encode({ type: "verdict", id, questions }));
    },

    onReview(handler): void {
      addReviewHandler(handlers, handler);
    },

    onCancel(handler): void {
      addCancelHandler(handlers, handler);
    },

    onChange(handler): void {
      handlers.change.push(handler);
    },

    async close(): Promise<void> {
      socket.destroy();
      await server.close();
    },
  };
}

// Another watcher owns the socket, so this one holds no queue and reports the counts the owner sends.
export async function viewerHost(options: SessionHostOptions): Promise<SessionHost> {
  const handlers = emptyHandlers();
  let remote: StateMessage | null = null;

  const socket = await attach(options.socketPath, options.client, handlers, (state) => {
    remote = state;
    handlers.change.forEach((handler) => handler());
  });

  return {
    socketPath: options.socketPath,
    owns: false,

    counts(): HostCounts {
      return { clients: remote?.clientCount ?? 0, waiting: remote?.waitingDepth ?? 0 };
    },

    refreshCounts(): void {
      socket.write(encode({ type: "status" }));
    },

    verdict(id: string, questions: Question[]): void {
      socket.write(encode({ type: "verdict", id, questions }));
    },

    onReview(handler): void {
      addReviewHandler(handlers, handler);
    },

    onCancel(handler): void {
      addCancelHandler(handlers, handler);
    },

    onChange(handler): void {
      handlers.change.push(handler);
    },

    close(): Promise<void> {
      socket.destroy();
      return Promise.resolve();
    },
  };
}
