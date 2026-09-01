import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { join } from "node:path";
import { test, expect, describe, afterEach } from "vitest";
import {
  startSessionServer,
  createLineReader,
  decodeLine,
  encode,
} from "../src/transports/session";
import type { SessionServer, WireMessage } from "../src/transports/session";
import { useIsolatedHome } from "./helpers/env";

const isolated = useIsolatedHome();

const WAIT_TIMEOUT_MS = 2000;
const POLL_MS = 5;

const openSockets: Socket[] = [];
const openServers: SessionServer[] = [];

afterEach(async () => {
  openSockets.forEach((socket) => socket.destroy());
  openSockets.length = 0;

  await Promise.all(openServers.map((server) => server.close()));
  openServers.length = 0;
});

// A test that fails before its own close would otherwise leave the listener bound.
async function startServer(socketPath: string): Promise<SessionServer> {
  const server = await startSessionServer({ socketPath });
  openServers.push(server);
  return server;
}

function connectClient(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);

    openSockets.push(socket);
    socket.setEncoding("utf-8");

    socket.once("error", reject);
    socket.once("connect", () => resolve(socket));
  });
}

// Each listener carries its own line reader, so two handlers on one socket never share buffer state.
function onMessage(socket: Socket, handler: (message: WireMessage) => void): void {
  const readLines = createLineReader();

  socket.on("data", (chunk: string) => {
    readLines(chunk).forEach((line) => {
      const message = decodeLine(line);

      if (message !== null) {
        handler(message);
      }
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A socket round trip has no completion callback, so a test waits on the condition it actually cares about.
async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }

    await sleep(POLL_MS);
  }

  throw new Error("condition never became true");
}

interface VerdictFrame {
  type: string;
  questions: unknown[];
}

// The act callback reports false until the review reaches the clients, so the helper retries instead of guessing a delay.
async function submitAndAwaitVerdict(
  socketPath: string,
  name: string,
  act: () => boolean,
): Promise<VerdictFrame> {
  const agent = await connectClient(socketPath);

  let received: VerdictFrame | null = null;

  onMessage(agent, (message) => {
    if (message.type === "verdict") {
      received = { type: message.type, questions: message.questions };
    }
  });

  agent.write(
    encode({ type: "submit", tool: "edit", path: `/repo/${name}`, before: "a", after: "b" }),
  );

  await waitFor(act);
  await waitFor(() => received !== null);

  if (received === null) {
    throw new Error("no verdict arrived");
  }

  return received;
}

describe("broadcast dispatch", () => {
  test("the first verdict completes the review and the other client hears cancel", async () => {
    const socketPath = join(isolated.tempDir("pair-bcast-"), "s.sock");
    const server = await startServer(socketPath);

    const first = await connectClient(socketPath);
    const second = await connectClient(socketPath);

    const cancelled: string[] = [];
    let reviewId = "";

    onMessage(first, (message) => {
      if (message.type === "review") {
        reviewId = message.id;
      }
    });

    onMessage(second, (message) => {
      if (message.type === "cancel") {
        cancelled.push(message.id);
      }
    });

    first.write(encode({ type: "attach", client: "tui" }));
    second.write(encode({ type: "attach", client: "web" }));

    await waitFor(() => server.clientCount() === 2);

    const verdict = await submitAndAwaitVerdict(socketPath, "a.ts", () => {
      if (reviewId === "") {
        return false;
      }

      first.write(encode({ type: "verdict", id: reviewId, questions: [] }));
      return true;
    });

    await waitFor(() => cancelled.length > 0);

    expect(verdict.questions).toEqual([]);
    expect(cancelled).toEqual([reviewId]);
    expect(server.waitingDepth()).toBe(0);
  });

  test("the server never waits for a second verdict", async () => {
    const socketPath = join(isolated.tempDir("pair-bcast2-"), "s.sock");
    const server = await startServer(socketPath);

    const answering = await connectClient(socketPath);
    const silent = await connectClient(socketPath);

    let reviewId = "";

    onMessage(answering, (message) => {
      if (message.type === "review") {
        reviewId = message.id;
      }
    });

    answering.write(encode({ type: "attach", client: "tui" }));
    silent.write(encode({ type: "attach", client: "web" }));

    await waitFor(() => server.clientCount() === 2);

    const verdict = await submitAndAwaitVerdict(socketPath, "b.ts", () => {
      if (reviewId === "") {
        return false;
      }

      answering.write(encode({ type: "verdict", id: reviewId, questions: [] }));
      return true;
    });

    expect(verdict.type).toBe("verdict");
  });

  test("a client that drops after an offer does not block the others", async () => {
    const socketPath = join(isolated.tempDir("pair-bcast3-"), "s.sock");
    const server = await startServer(socketPath);

    const staying = await connectClient(socketPath);
    const leaving = await connectClient(socketPath);

    let reviewId = "";

    onMessage(staying, (message) => {
      if (message.type === "review") {
        reviewId = message.id;
      }
    });

    staying.write(encode({ type: "attach", client: "tui" }));
    leaving.write(encode({ type: "attach", client: "web" }));

    await waitFor(() => server.clientCount() === 2);

    const verdict = await submitAndAwaitVerdict(socketPath, "c.ts", () => {
      if (reviewId === "") {
        return false;
      }

      leaving.destroy();
      staying.write(encode({ type: "verdict", id: reviewId, questions: [] }));
      return true;
    });

    expect(verdict.type).toBe("verdict");
  });
});
