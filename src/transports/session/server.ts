import { createServer, createConnection } from "node:net";
import type { Server, Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { EditRequest } from "../transport.types";
import type { QueueState } from "./queue.types";
import {
  complete,
  emptyQueue,
  enqueue,
  findReview,
  release,
  takeNext,
  waitingDepth,
} from "./queue";
import { createLineReader, decodeLine, encode } from "./wire";
import type { ServerMessage, VerdictMessage } from "./wire.types";
import type { SessionServer, SessionServerOptions } from "./server.types";

const ID_BYTES = 8;
const STALE_PROBE_TIMEOUT_MS = 250;

function defaultGenerateId(): string {
  return randomBytes(ID_BYTES).toString("hex");
}

function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Best-effort cleanup only.
  }
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

async function bindSocket(server: Server, path: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });

  try {
    await listenOn(server, path);
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
}

export async function startSessionServer(options: SessionServerOptions): Promise<SessionServer> {
  const generateId = options.generateId ?? defaultGenerateId;

  let queue: QueueState = emptyQueue();
  const agents = new Map<string, Socket>();
  const clients = new Map<Socket, string | null>();
  const changeHandlers: Array<() => void> = [];

  function announce(): void {
    changeHandlers.forEach((handler) => handler());
  }

  function send(socket: Socket, message: ServerMessage): void {
    if (!socket.destroyed) {
      socket.write(encode(message));
    }
  }

  function idleClient(): Socket | null {
    const entry = [...clients.entries()].find(([, held]) => held === null);
    return entry === undefined ? null : entry[0];
  }

  function clientHolding(id: string): Socket | null {
    const entry = [...clients.entries()].find(([, held]) => held === id);
    return entry === undefined ? null : entry[0];
  }

  // Every idle client takes a waiting review, so a burst of submits spreads across whoever is attached.
  function dispatch(): void {
    let client = idleClient();

    while (client !== null) {
      const result = takeNext(queue);

      if (result.review === null) {
        break;
      }

      queue = result.state;
      clients.set(client, result.review.id);

      send(client, {
        type: "review",
        id: result.review.id,
        tool: result.review.request.tool,
        path: result.review.request.filePath,
        before: result.review.request.before,
        after: result.review.request.after,
      });

      client = idleClient();
    }

    announce();
  }

  function handleSubmit(socket: Socket, request: EditRequest): void {
    const id = generateId();
    queue = enqueue(queue, id, request);
    agents.set(id, socket);
    dispatch();
  }

  function handleAttach(socket: Socket): void {
    clients.set(socket, null);
    dispatch();
  }

  function handleVerdict(socket: Socket, message: VerdictMessage): void {
    const agent = agents.get(message.id);

    if (agent !== undefined) {
      send(agent, message);
      agents.delete(message.id);
    }

    queue = complete(queue, message.id);

    if (clients.get(socket) === message.id) {
      clients.set(socket, null);
    }

    dispatch();
  }

  // A hook that dies waiting leaves a review nobody can answer, so the client holding it hears cancel.
  function dropAgent(socket: Socket): void {
    const owned = [...agents.entries()].filter(([, agentSocket]) => agentSocket === socket);

    owned.forEach(([id]) => {
      agents.delete(id);

      const holder = clientHolding(id);

      if (holder !== null) {
        send(holder, { type: "cancel", id });
        clients.set(holder, null);
      }

      queue = complete(queue, id);
    });

    if (owned.length > 0) {
      dispatch();
    }
  }

  function dropClient(socket: Socket): void {
    const held = clients.get(socket);

    if (held === undefined) {
      return;
    }

    clients.delete(socket);

    if (held !== null && findReview(queue, held) !== null) {
      queue = release(queue, held);
    }

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

    if (message.type === "verdict") {
      handleVerdict(socket, message);
    }
  }

  function handleConnection(socket: Socket): void {
    socket.setEncoding("utf-8");
    const readLines = createLineReader();

    socket.on("data", (chunk: string) => {
      readLines(chunk).forEach((line) => handleLine(socket, line));
    });

    socket.on("error", () => socket.destroy());

    socket.on("close", () => {
      dropAgent(socket);
      dropClient(socket);
    });
  }

  const server = createServer(handleConnection);
  await bindSocket(server, options.socketPath);

  return {
    socketPath: options.socketPath,

    clientCount(): number {
      return clients.size;
    },

    waitingDepth(): number {
      return waitingDepth(queue);
    },

    onChange(handler: () => void): void {
      changeHandlers.push(handler);
    },

    close(): Promise<void> {
      return new Promise((resolve) => {
        [...clients.keys()].forEach((socket) => socket.destroy());
        [...agents.values()].forEach((socket) => socket.destroy());

        server.close(() => {
          removeQuietly(options.socketPath);
          resolve();
        });
      });
    },
  };
}
