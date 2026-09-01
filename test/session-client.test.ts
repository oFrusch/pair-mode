import { createServer, createConnection } from "node:net";
import type { Server, Socket } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test, describe, expect, beforeEach, afterEach } from "vitest";
import {
  createSessionTransport,
  createLineReader,
  decodeLine,
  encode,
} from "../src/transports/session";
import { startSessionServer } from "../src/transports/session";
import type { SessionServer } from "../src/transports/session";
import { DEFAULT_CONFIG } from "../src/core/config";
import type { PairConfig } from "../src/core/config";
import type { EditRequest } from "../src/transports";
import { sessionKey, sessionKeySocketPath, sessionSocketPath } from "../src/core/state";
import { useIsolatedHome } from "./helpers/env";

const isolated = useIsolatedHome();

let socketPath: string;
let fake: Server | null = null;
let server: SessionServer | null = null;
const accepted: Socket[] = [];

beforeEach(() => {
  const dir = isolated.tempDir("pair-cli-");
  socketPath = join(dir, "s.sock");
});

afterEach(async () => {
  accepted.forEach((socket) => socket.destroy());
  accepted.length = 0;

  if (fake !== null) {
    await new Promise<void>((resolve) => fake?.close(() => resolve()));
    fake = null;
  }

  if (server !== null) {
    await server.close();
    server = null;
  }
});

function configWithTimeout(seconds: number): PairConfig {
  return { ...DEFAULT_CONFIG, transport: "session", session: { timeout: seconds } };
}

const request: EditRequest = {
  tool: "edit",
  filePath: "/repo/one.ts",
  before: "a",
  after: "b",
};

// The fake server answers every submit with the questions the test wants, so no watcher is involved.
function serverAnswering(
  questions: { line: number | null; code: string; text: string }[],
): Promise<void> {
  return new Promise((resolve) => {
    fake = createServer((socket: Socket) => {
      accepted.push(socket);
      socket.setEncoding("utf-8");
      const readLines = createLineReader();

      socket.on("data", (chunk: string) => {
        readLines(chunk).forEach((line) => {
          const message = decodeLine(line);

          if (message?.type === "submit") {
            socket.write(encode({ type: "verdict", id: "id1", questions }));
          }
        });
      });
    });

    fake.listen(socketPath, resolve);
  });
}

function serverThatNeverAnswers(): Promise<void> {
  return new Promise((resolve) => {
    fake = createServer((socket: Socket) => accepted.push(socket));
    fake.listen(socketPath, resolve);
  });
}

function serverThatHangsUp(): Promise<void> {
  return new Promise((resolve) => {
    fake = createServer((socket: Socket) => socket.destroy());
    fake.listen(socketPath, resolve);
  });
}

test("a server that answers produces a reviewed outcome carrying its questions", async () => {
  await serverAnswering([{ line: 2, code: "x", text: "why?" }]);

  const transport = createSessionTransport(socketPath);
  const outcome = await transport.review(request, configWithTimeout(5));

  expect(outcome).toEqual({
    reviewed: true,
    questions: [{ line: 2, code: "x", text: "why?" }],
  });
});

test("a server answering with no questions still reports the review as seen", async () => {
  await serverAnswering([]);

  const transport = createSessionTransport(socketPath);
  const outcome = await transport.review(request, configWithTimeout(5));

  expect(outcome).toEqual({ reviewed: true, questions: [] });
});

test("a server that never answers fails open once the timeout expires", async () => {
  await serverThatNeverAnswers();

  const transport = createSessionTransport(socketPath);
  const outcome = await transport.review(request, configWithTimeout(1));

  expect(outcome.reviewed).toBe(false);

  if (!outcome.reviewed) {
    expect(outcome.detail).toContain("no verdict within");
  }
}, 10000);

test("a server that hangs up mid-review fails open", async () => {
  await serverThatHangsUp();

  const transport = createSessionTransport(socketPath);
  const outcome = await transport.review(request, configWithTimeout(5));

  expect(outcome.reviewed).toBe(false);

  if (!outcome.reviewed) {
    expect(outcome.detail).toContain("closed before answering");
  }
});

test("a missing socket file fails open without waiting for the timeout", async () => {
  const transport = createSessionTransport(join(tmpdir(), "pair-mode-absent.sock"));
  const outcome = await transport.review(request, configWithTimeout(60));

  expect(outcome).toEqual({ reviewed: false, detail: "no pair-mode watcher attached" });
});

// A restarted watcher can own the path by the time the error fires, so the client must never unlink it.
test("a stale socket file fails open and is left in place for bindSocket to clear", async () => {
  writeFileSync(socketPath, "");

  const transport = createSessionTransport(socketPath);
  const outcome = await transport.review(request, configWithTimeout(60));

  expect(outcome).toEqual({ reviewed: false, detail: "no pair-mode watcher attached" });
  expect(existsSync(socketPath)).toBe(true);
});

test("the session transport carries the session name", () => {
  expect(createSessionTransport(socketPath).name).toBe("session");
});

// This is the whole contract end to end: a real server, a real client, and the real transport.
test("a real session server round-trips a submit from the transport to an attached client", async () => {
  server = await startSessionServer({ socketPath, generateId: () => "id1" });

  const client = createConnection(socketPath);
  client.setEncoding("utf-8");
  const readLines = createLineReader();

  await new Promise<void>((resolve) => client.once("connect", () => resolve()));

  client.on("data", (chunk: string) => {
    readLines(chunk).forEach((line) => {
      const message = decodeLine(line);

      if (message?.type === "review") {
        client.write(
          encode({
            type: "verdict",
            id: message.id,
            questions: [{ line: 1, code: message.path, text: "seen it" }],
          }),
        );
      }
    });
  });

  client.write(encode({ type: "attach", client: "tui" }));

  const transport = createSessionTransport(socketPath);
  const outcome = await transport.review(request, configWithTimeout(5));

  client.destroy();

  expect(outcome).toEqual({
    reviewed: true,
    questions: [{ line: 1, code: "/repo/one.ts", text: "seen it" }],
  });
});

const PARENT_SESSION_ID = "d95655de-eb7f-45e5-867d-9797a355353e";

// A socket path is capped at 104 bytes, and the isolated state home under /var/folders already spends more than that.
function useShortStateHome(): () => string {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join("/tmp", "pm-"));
    process.env["XDG_STATE_HOME"] = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  return () => dir;
}

function connectClient(path: string): Promise<Socket> {
  const client = createConnection(path);
  accepted.push(client);
  client.setEncoding("utf-8");

  return new Promise((resolve) => client.once("connect", () => resolve(client)));
}

// Answers every review the server pushes, so the transport under test gets a real verdict back.
function onReview(client: Socket, handle: (review: { id: string; path: string }) => void): void {
  const readLines = createLineReader();

  client.on("data", (chunk: string) => {
    readLines(chunk).forEach((line) => {
      const message = decodeLine(line);

      if (message?.type === "review") {
        handle({ id: message.id, path: message.path });
      }
    });
  });
}

function editRequest(filePath: string, sessionId?: string): EditRequest {
  return { tool: "Write", filePath, before: "before\n", after: "after\n", sessionId };
}

describe("the resolution chain in the client", () => {
  useShortStateHome();

  test("a request with a session id reaches the session socket, not the directory socket", async () => {
    const key = sessionKey(PARENT_SESSION_ID);
    const sessionSocket = sessionKeySocketPath(key);

    mkdirSync(dirname(sessionSocket), { recursive: true });
    server = await startSessionServer({ socketPath: sessionSocket });

    const seen: string[] = [];
    const client = await connectClient(sessionSocket);

    onReview(client, (review) => {
      seen.push(review.path);
      client.write(encode({ type: "verdict", id: review.id, questions: [] }));
    });

    client.write(encode({ type: "attach", client: "tui" }));

    const directory = isolated.tempDir("pair-chain-");
    const filePath = join(directory, "main.ts");
    writeFileSync(filePath, "before\n", "utf-8");

    const outcome = await createSessionTransport().review(
      editRequest(filePath, PARENT_SESSION_ID),
      configWithTimeout(5),
    );

    expect(outcome.reviewed).toBe(true);
    expect(seen).toEqual([filePath]);
  });

  test("a request with no session id still resolves the directory socket", async () => {
    const directory = isolated.tempDir("pair-chain-dir-");
    const directorySocket = sessionSocketPath(directory);

    mkdirSync(dirname(directorySocket), { recursive: true });
    server = await startSessionServer({ socketPath: directorySocket });

    const seen: string[] = [];
    const client = await connectClient(directorySocket);

    onReview(client, (review) => {
      seen.push(review.path);
      client.write(encode({ type: "verdict", id: review.id, questions: [] }));
    });

    client.write(encode({ type: "attach", client: "tui" }));

    const filePath = join(directory, "main.ts");
    writeFileSync(filePath, "before\n", "utf-8");

    const outcome = await createSessionTransport().review(
      editRequest(filePath),
      configWithTimeout(5),
    );

    expect(outcome.reviewed).toBe(true);
    expect(seen).toEqual([filePath]);
  });

  // A Claude Code subagent sends its parent's session_id, so its edits belong on the parent's watcher.
  test("a subagent edit carrying the parent session id reaches the parent watcher", async () => {
    const key = sessionKey(PARENT_SESSION_ID);
    const sessionSocket = sessionKeySocketPath(key);

    mkdirSync(dirname(sessionSocket), { recursive: true });
    server = await startSessionServer({ socketPath: sessionSocket });

    const seen: string[] = [];
    const client = await connectClient(sessionSocket);

    onReview(client, (review) => {
      seen.push(review.path);
      client.write(encode({ type: "verdict", id: review.id, questions: [] }));
    });

    client.write(encode({ type: "attach", client: "tui" }));

    const directory = isolated.tempDir("pair-subagent-");
    const parentFile = join(directory, "parent.ts");
    const subagentFile = join(directory, "subagent.ts");
    writeFileSync(parentFile, "before\n", "utf-8");
    writeFileSync(subagentFile, "before\n", "utf-8");

    const transport = createSessionTransport();

    const parentOutcome = await transport.review(
      editRequest(parentFile, PARENT_SESSION_ID),
      configWithTimeout(5),
    );

    const subagentOutcome = await transport.review(
      editRequest(subagentFile, PARENT_SESSION_ID),
      configWithTimeout(5),
    );

    expect(parentOutcome.reviewed).toBe(true);
    expect(subagentOutcome.reviewed).toBe(true);
    expect(seen).toEqual([parentFile, subagentFile]);
  });
  // A crashed watcher leaves its socket file behind, so the chain must not post an edit into a dead socket.
  test("a stale session socket is removed and the directory socket answers", async () => {
    const stale = sessionKeySocketPath(sessionKey(PARENT_SESSION_ID));

    mkdirSync(dirname(stale), { recursive: true });
    writeFileSync(stale, "", "utf-8");

    const directory = isolated.tempDir("pair-stale-");
    const directorySocket = sessionSocketPath(directory);
    server = await startSessionServer({ socketPath: directorySocket });

    const seen: string[] = [];
    const client = await connectClient(directorySocket);

    onReview(client, (review) => {
      seen.push(review.path);
      client.write(encode({ type: "verdict", id: review.id, questions: [] }));
    });

    client.write(encode({ type: "attach", client: "tui" }));

    const filePath = join(directory, "main.ts");
    writeFileSync(filePath, "before\n", "utf-8");

    const outcome = await createSessionTransport().review(
      editRequest(filePath, PARENT_SESSION_ID),
      configWithTimeout(5),
    );

    expect(outcome.reviewed).toBe(true);
    expect(seen).toEqual([filePath]);
    expect(existsSync(stale)).toBe(false);
  });
});
