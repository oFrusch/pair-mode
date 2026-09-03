import { createServer, createConnection } from "node:net";
import type { Server, Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EditRequest } from "../transport.types";
import type { SessionRecord } from "../../core/state";
import type { QueuedReview, QueueState } from "./queue.types";
import {
  complete,
  emptyQueue,
  enqueue,
  findReview,
  offerAll,
  offeredReviews,
  release,
  waitingDepth,
} from "./queue";
import { createLineReader, decodeLine, encode } from "./wire";
import type { ServerMessage, VerdictMessage } from "./wire.types";
import type {
  Client,
  Clients,
  ReviewId,
  SessionServer,
  SessionServerOptions,
} from "./server.types";
import { removeQuietly } from "../../helpers";

const ID_BYTES = 8;
const OWNER_ONLY_DIR = 0o700;
const OWNER_ONLY_SOCKET = 0o600;
const OWNER_ONLY_RECORD = 0o600;
const STALE_PROBE_TIMEOUT_MS = 250;

function defaultGenerateId(): string {
  return randomBytes(ID_BYTES).toString("hex");
}

// An accept error must never kill the watcher, so it goes to stderr unless the caller wants it.
function defaultReportError(error: Error): void {
  process.stderr.write(`pair-mode session server error: ${error.message}\n`);
}

// A socket file outlives a crashed watcher, so a refused connection means the file is stale and safe to unlink.
export function probeSocket(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createConnection(path);

    const settle = (alive: boolean): void => {
      probe.destroy();
      resolve(alive);
    };

    probe.setTimeout(STALE_PROBE_TIMEOUT_MS, () => settle(false));
    probe.once("connect", () => settle(true));
    probe.once("error", () => settle(false));
  });
}

function listenOn(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);

    server.listen(path, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}

// The socket gates every edit, so only its owner may attach as a client.
function restrictToOwner(path: string): void {
  try {
    chmodSync(path, OWNER_ONLY_SOCKET);
  } catch {
    // A platform that refuses chmod on a socket still serves the owner.
  }
}

async function bindSocket(server: Server, path: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true, mode: OWNER_ONLY_DIR });

  try {
    await listenOn(server, path);
    restrictToOwner(path);
    return;
  } catch (error) {
    if (!isAddressInUse(error)) {
      throw error;
    }
  }

  if (await probeSocket(path)) {
    throw new Error(`another pair-mode session already owns ${path}`);
  }

  removeQuietly(path);
  await listenOn(server, path);
  restrictToOwner(path);
}

// The sidecar names a session for `pair-mode sessions`, so a person reads a label rather than a socket path.
function recordPathFor(socketPath: string): string {
  return socketPath.replace(/\.sock$/, ".json");
}

function writeRecord(socketPath: string, record: SessionRecord): void {
  try {
    writeFileSync(recordPathFor(socketPath), JSON.stringify(record, null, 2) + "\n", {
      encoding: "utf-8",
      mode: OWNER_ONLY_RECORD,
    });
  } catch {
    // A sidecar that fails to write must never stop a watcher from serving reviews.
  }
}

export async function startSessionServer(options: SessionServerOptions): Promise<SessionServer> {
  const generateId = options.generateId ?? defaultGenerateId;
  const reportError = options.onError ?? defaultReportError;

  let queue: QueueState = emptyQueue();
  const agentByReview = new Map<ReviewId, Socket>();
  const clients: Clients = new Map();
  const clientBySocket = new Map<Socket, Client>();
  const clientsByReview = new Map<ReviewId, Clients>();
  const connections = new Set<Socket>();
  const changeHandlers: Array<() => void> = [];

  let lastAttachAt: string | null = null;
  let nextClientId = 0;

  function announce(): void {
    changeHandlers.forEach((handler) => handler());
  }

  function send(socket: Socket, message: ServerMessage): void {
    if (!socket.destroyed) {
      socket.write(encode(message));
    }
  }

  function reviewMessage(review: QueuedReview): ServerMessage {
    return {
      type: "review",
      id: review.id,
      tool: review.request.tool,
      path: review.request.filePath,
      before: review.request.before,
      after: review.request.after,
    };
  }

  // Every attached client is a view of one review, so all of them see it and the first verdict ends it.
  function dispatch(): void {
    if (clients.size === 0) {
      announce();
      return;
    }

    const result = offerAll(queue);
    queue = result.state;

    result.reviews.forEach((review) => {
      clientsByReview.set(review.id, new Map(clients));
      clients.forEach((client) => send(client.socket, reviewMessage(review)));
    });

    announce();
  }

  function handleSubmit(socket: Socket, request: EditRequest): void {
    const id = generateId();
    queue = enqueue(queue, id, request);
    agentByReview.set(id, socket);
    dispatch();
  }

  // A review already offered never returns through offerAll, so a late client receives it straight from the queue.
  function handleAttach(socket: Socket): void {
    // A second attach on one connection would orphan the first client id, so the repeat is ignored.
    if (clientBySocket.has(socket)) {
      return;
    }

    nextClientId += 1;
    const client: Client = { id: `c${nextClientId}`, socket };

    clients.set(client.id, client);
    clientBySocket.set(socket, client);
    lastAttachAt = new Date().toISOString();

    offeredReviews(queue).forEach((review) => {
      const viewers = clientsByReview.get(review.id) ?? new Map();

      viewers.set(client.id, client);
      clientsByReview.set(review.id, viewers);

      send(socket, reviewMessage(review));
    });

    dispatch();
  }

  // The first verdict wins. Every other client viewing the same review hears cancel instead.
  function handleVerdict(socket: Socket, message: VerdictMessage): void {
    const answering = clientBySocket.get(socket);

    if (!answering) {
      return;
    }

    const viewers = clientsByReview.get(message.id);

    if (!viewers?.has(answering.id)) {
      return;
    }

    const agent = agentByReview.get(message.id);

    if (agent) {
      send(agent, message);
      agentByReview.delete(message.id);
    }

    viewers.forEach((viewer) => {
      if (viewer.id !== answering.id) {
        send(viewer.socket, { type: "cancel", id: message.id });
      }
    });

    clientsByReview.delete(message.id);
    queue = complete(queue, message.id);

    dispatch();
  }

  // A hook that dies waiting leaves a review nobody can answer, so every client viewing it hears cancel.
  function dropAgent(socket: Socket): void {
    const owned = [...agentByReview.entries()].filter(([, agentSocket]) => agentSocket === socket);

    if (owned.length === 0) {
      return;
    }

    owned.forEach(([id]) => {
      agentByReview.delete(id);

      clientsByReview.get(id)?.forEach((viewer) => send(viewer.socket, { type: "cancel", id }));
      clientsByReview.delete(id);

      queue = complete(queue, id);
    });

    dispatch();
  }

  // The last client to drop hands its reviews back, so a fresh attach picks them up.
  function dropClient(socket: Socket): void {
    const leaving = clientBySocket.get(socket);

    if (!leaving) {
      return;
    }

    clientBySocket.delete(socket);
    clients.delete(leaving.id);

    clientsByReview.forEach((viewers, id) => {
      viewers.delete(leaving.id);

      if (viewers.size === 0 && findReview(queue, id) !== null) {
        queue = release(queue, id);
        clientsByReview.delete(id);
      }
    });

    dispatch();
  }

  function handleLine(socket: Socket, line: string): void {
    const message = decodeLine(line);

    if (message === null) {
      return;
    }

    if (message.type === "submit") {
      handleSubmit(socket, {
        tool: message.tool,
        filePath: message.path,
        before: message.before,
        after: message.after,
      });
      return;
    }

    if (message.type === "attach") {
      handleAttach(socket);
      return;
    }

    if (message.type === "status") {
      send(socket, {
        type: "state",
        clientCount: clients.size,
        waitingDepth: waitingDepth(queue),
        lastAttachAt,
      });
      return;
    }

    if (message.type === "verdict") {
      handleVerdict(socket, message);
    }
  }

  function handleConnection(socket: Socket): void {
    connections.add(socket);
    socket.setEncoding("utf-8");
    const readLines = createLineReader();

    socket.on("data", (chunk: string) => {
      readLines(chunk).forEach((line) => handleLine(socket, line));
    });

    socket.on("error", () => socket.destroy());

    socket.on("close", () => {
      connections.delete(socket);
      dropAgent(socket);
      dropClient(socket);
    });
  }

  const server = createServer(handleConnection);
  await bindSocket(server, options.socketPath);

  if (options.record !== undefined) {
    writeRecord(options.socketPath, options.record);
  }

  // listenOn drops its own error listener on success, so an accept error after bind would otherwise be uncaught.
  server.on("error", reportError);

  return {
    socketPath: options.socketPath,

    clientCount(): number {
      return clients.size;
    },

    lastAttachAt(): string | null {
      return lastAttachAt;
    },

    waitingDepth(): number {
      return waitingDepth(queue);
    },

    onChange(handler: () => void): void {
      changeHandlers.push(handler);
    },

    close(): Promise<void> {
      return new Promise((resolve) => {
        // net.Server.close waits on every accepted connection, including one that never identified itself.
        [...connections].forEach((socket) => socket.destroy());

        server.close(() => {
          removeQuietly(options.socketPath);
          removeQuietly(recordPathFor(options.socketPath));
          resolve();
        });
      });
    },
  };
}
