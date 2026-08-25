import { createConnection, createServer } from "node:net";
import type { Socket } from "node:net";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, beforeEach, afterEach } from "vitest";
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

let socketPath: string;
let server: SessionServer | null = null;
const openSockets: Socket[] = [];

beforeEach(() => {
  const dir = isolated.tempDir("pair-sess-");
  socketPath = join(dir, "s.sock");
});

afterEach(async () => {
  if (server !== null) {
    await server.close();
    server = null;
  }

  openSockets.forEach((socket) => socket.destroy());
  openSockets.length = 0;
});

interface Peer {
  socket: Socket;
  received: WireMessage[];
  send(message: WireMessage): void;
}

function connectPeer(): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const received: WireMessage[] = [];
    const readLines = createLineReader();

    openSockets.push(socket);
    socket.setEncoding("utf-8");

    socket.on("data", (chunk: string) => {
      readLines(chunk).forEach((line) => {
        const message = decodeLine(line);

        if (message !== null) {
          received.push(message);
        }
      });
    });

    socket.once("error", reject);

    socket.once("connect", () => {
      resolve({
        socket,
        received,
        send: (message: WireMessage) => socket.write(encode(message)),
      });
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

function submitFor(name: string): WireMessage {
  return { type: "submit", tool: "edit", path: `/repo/${name}.ts`, before: "a", after: "b" };
}

function sequentialIds(): () => string {
  let count = 0;

  return () => {
    count += 1;
    return `id${count}`;
  };
}

async function startWithSequentialIds(): Promise<SessionServer> {
  const started = await startSessionServer({ socketPath, generateId: sequentialIds() });
  server = started;
  return started;
}

test("a client that attaches after a submit receives the queued review", async () => {
  await startWithSequentialIds();

  const agent = await connectPeer();
  agent.send(submitFor("one"));

  const client = await connectPeer();
  client.send({ type: "attach", client: "tui" });

  await waitFor(() => client.received.length > 0);

  expect(client.received[0]).toEqual({
    type: "review",
    id: "id1",
    tool: "edit",
    path: "/repo/one.ts",
    before: "a",
    after: "b",
  });
});

test("a client attached before a submit receives the review as soon as it arrives", async () => {
  await startWithSequentialIds();

  const client = await connectPeer();
  client.send({ type: "attach", client: "tui" });

  const agent = await connectPeer();
  agent.send(submitFor("one"));

  await waitFor(() => client.received.length > 0);

  expect(client.received[0]?.type).toBe("review");
});

test("a verdict from the client reaches the agent that submitted the review", async () => {
  await startWithSequentialIds();

  const agent = await connectPeer();
  agent.send(submitFor("one"));

  const client = await connectPeer();
  client.send({ type: "attach", client: "tui" });

  await waitFor(() => client.received.length > 0);
  client.send({ type: "verdict", id: "id1", questions: [{ line: 2, code: "x", text: "why?" }] });

  await waitFor(() => agent.received.length > 0);

  expect(agent.received[0]).toEqual({
    type: "verdict",
    id: "id1",
    questions: [{ line: 2, code: "x", text: "why?" }],
  });
});

test("one client answering twice receives two reviews in submit order", async () => {
  await startWithSequentialIds();

  const first = await connectPeer();
  first.send(submitFor("one"));

  const second = await connectPeer();
  second.send(submitFor("two"));

  const client = await connectPeer();
  client.send({ type: "attach", client: "tui" });

  await waitFor(() => client.received.length > 0);
  client.send({ type: "verdict", id: "id1", questions: [] });

  await waitFor(() => client.received.length > 1);

  const paths = client.received.map((message) =>
    message.type === "review" ? message.path : "other",
  );

  expect(paths).toEqual(["/repo/one.ts", "/repo/two.ts"]);
});

test("two attached clients each take one of two queued reviews", async () => {
  await startWithSequentialIds();

  const firstAgent = await connectPeer();
  firstAgent.send(submitFor("one"));

  const secondAgent = await connectPeer();
  secondAgent.send(submitFor("two"));

  const firstClient = await connectPeer();
  firstClient.send({ type: "attach", client: "tui" });

  const secondClient = await connectPeer();
  secondClient.send({ type: "attach", client: "web" });

  await waitFor(() => firstClient.received.length > 0 && secondClient.received.length > 0);

  expect(firstClient.received).toHaveLength(1);
  expect(secondClient.received).toHaveLength(1);
});

test("an agent that disconnects while waiting cancels the review on the client holding it", async () => {
  await startWithSequentialIds();

  const agent = await connectPeer();
  agent.send(submitFor("one"));

  const client = await connectPeer();
  client.send({ type: "attach", client: "tui" });

  await waitFor(() => client.received.length > 0);
  agent.socket.destroy();

  await waitFor(() => client.received.length > 1);

  expect(client.received[1]).toEqual({ type: "cancel", id: "id1" });
});

test("a client that drops mid-review hands the review to the next client", async () => {
  await startWithSequentialIds();

  const agent = await connectPeer();
  agent.send(submitFor("one"));

  const first = await connectPeer();
  first.send({ type: "attach", client: "tui" });

  await waitFor(() => first.received.length > 0);
  first.socket.destroy();

  const second = await connectPeer();
  second.send({ type: "attach", client: "tui" });

  await waitFor(() => second.received.length > 0);

  expect(second.received[0]).toEqual({
    type: "review",
    id: "id1",
    tool: "edit",
    path: "/repo/one.ts",
    before: "a",
    after: "b",
  });
});

test("the server reports the waiting depth and the attached client count", async () => {
  const started = await startWithSequentialIds();

  expect(started.clientCount()).toBe(0);
  expect(started.waitingDepth()).toBe(0);

  const agent = await connectPeer();
  agent.send(submitFor("one"));

  await waitFor(() => started.waitingDepth() === 1);

  const client = await connectPeer();
  client.send({ type: "attach", client: "tui" });

  await waitFor(() => started.clientCount() === 1);
  expect(started.waitingDepth()).toBe(0);
});

test("a change handler fires when a review arrives", async () => {
  const started = await startWithSequentialIds();
  let changes = 0;
  started.onChange(() => {
    changes += 1;
  });

  const agent = await connectPeer();
  agent.send(submitFor("one"));

  await waitFor(() => changes > 0);

  expect(changes).toBeGreaterThan(0);
});

test("a malformed line never kills the connection", async () => {
  await startWithSequentialIds();

  const agent = await connectPeer();
  agent.socket.write("garbage\n");
  agent.send(submitFor("one"));

  const client = await connectPeer();
  client.send({ type: "attach", client: "tui" });

  await waitFor(() => client.received.length > 0);

  expect(client.received[0]?.type).toBe("review");
});

test("the server unlinks a stale socket file and binds in its place", async () => {
  writeFileSync(socketPath, "");

  const started = await startWithSequentialIds();
  const client = await connectPeer();
  client.send({ type: "attach", client: "tui" });

  await waitFor(() => started.clientCount() === 1);

  expect(started.clientCount()).toBe(1);
});

test("the server refuses to bind over a socket another server still owns", async () => {
  const other = createServer();
  await new Promise<void>((resolve) => other.listen(socketPath, resolve));

  await expect(startSessionServer({ socketPath })).rejects.toThrow("already owns");

  await new Promise<void>((resolve) => other.close(() => resolve()));
});

test("close removes the socket file", async () => {
  const started = await startWithSequentialIds();

  expect(existsSync(socketPath)).toBe(true);

  await started.close();
  server = null;

  expect(existsSync(socketPath)).toBe(false);
});

test("close resolves promptly with a bare connection that never identifies itself", async () => {
  const started = await startWithSequentialIds();

  const bare = createConnection(socketPath);
  openSockets.push(bare);
  await new Promise<void>((resolve) => bare.once("connect", () => resolve()));

  const closedAt = Date.now();
  await started.close();
  server = null;

  expect(Date.now() - closedAt).toBeLessThan(WAIT_TIMEOUT_MS);
  expect(existsSync(socketPath)).toBe(false);
}, 10000);
