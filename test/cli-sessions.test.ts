import { createConnection, createServer } from "node:net";
import type { Socket } from "node:net";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, describe } from "vitest";
import { useIsolatedHome, useShortStateHome } from "./helpers/env";
import { listSessions, sweepDeadSessions } from "../src/cli/sessions";
import { startSessionServer, encode } from "../src/transports/session";
import { sessionsDir } from "../src/core/state";

useIsolatedHome();

const POLL_MS = 5;
const WAIT_TIMEOUT_MS = 2000;
const DEFAULT_CREATED_AT = "2026-09-01T10:00:00.000Z";

function connectClient(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);

    socket.setEncoding("utf-8");
    socket.once("error", reject);
    socket.once("connect", () => resolve(socket));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A socket write has no completion callback, so the test waits on the condition it actually cares about.
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

// A server that accepts a connection but answers nothing stands in for a watcher whose event loop is blocked.
function startMuteServer(socketPath: string): Promise<() => Promise<void>> {
  return new Promise((resolve, reject) => {
    const accepted: Socket[] = [];
    const server = createServer((socket) => accepted.push(socket));

    server.once("error", reject);

    // The mute server never reads, so an accepted socket must be destroyed by hand before close can finish.
    const stop = (): Promise<void> =>
      new Promise((done) => {
        accepted.forEach((socket) => socket.destroy());
        server.close(() => done());
      });

    server.listen(socketPath, () => resolve(stop));
  });
}

function writeRecord(
  id: string,
  label: string,
  directory: string,
  createdAt: string = DEFAULT_CREATED_AT,
): void {
  mkdirSync(sessionsDir(), { recursive: true });

  const record = {
    id,
    kind: "session",
    label,
    directory,
    branch: "main",
    agentSessionId: "abc",
    agentKind: "claude-code",
    createdAt,
    pid: process.pid,
  };

  writeFileSync(join(sessionsDir(), `${id}.json`), JSON.stringify(record), "utf-8");
}

describe("listSessions", () => {
  useShortStateHome();

  test("reports a live session with its label and client count", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const id = "s-11111111";
    const socketPath = join(sessionsDir(), `${id}.sock`);

    writeRecord(id, "pair-mode@main", "/repo");
    const server = await startSessionServer({ socketPath });

    const result = await listSessions();

    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.id).toBe(id);
    expect(result.listings[0]?.label).toBe("pair-mode@main");
    expect(result.listings[0]?.clients).toBe(0);
    expect(result.text).toContain("pair-mode@main");

    await server.close();
  });

  test("sweeps a dead socket with its sidecar", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const id = "s-22222222";
    const socketPath = join(sessionsDir(), `${id}.sock`);
    const recordPath = join(sessionsDir(), `${id}.json`);

    writeRecord(id, "dead@main", "/repo");
    writeFileSync(socketPath, "", "utf-8");

    const result = await listSessions();

    expect(result.listings).toHaveLength(0);
    expect(result.swept).toContain(id);
    expect(existsSync(socketPath)).toBe(false);
    expect(existsSync(recordPath)).toBe(false);
  });

  test("spares a live socket during a sweep", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const id = "s-33333333";
    const socketPath = join(sessionsDir(), `${id}.sock`);

    writeRecord(id, "live@main", "/repo");
    const server = await startSessionServer({ socketPath });

    const swept = await sweepDeadSessions();

    expect(swept).toEqual([]);
    expect(existsSync(socketPath)).toBe(true);

    await server.close();
  });

  test("a live socket with no sidecar still lists, with an unknown label", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const id = "s-44444444";
    const socketPath = join(sessionsDir(), `${id}.sock`);
    const server = await startSessionServer({ socketPath });

    const result = await listSessions();

    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.label).toBe("unknown");

    await server.close();
  });

  test("a malformed sidecar never hides a live socket", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const id = "s-55555555";
    const socketPath = join(sessionsDir(), `${id}.sock`);

    writeFileSync(join(sessionsDir(), `${id}.json`), "{ not json", "utf-8");
    const server = await startSessionServer({ socketPath });

    const result = await listSessions();

    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.id).toBe(id);

    await server.close();
  });

  test("an empty sessions directory reports no sessions and exits 0", async () => {
    const result = await listSessions();

    expect(result.listings).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain("no pair-mode sessions");
  });

  test("the client count reflects a real attach", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const id = "s-66666666";
    const socketPath = join(sessionsDir(), `${id}.sock`);

    writeRecord(id, "attached@main", "/repo");
    const server = await startSessionServer({ socketPath });

    const client = await connectClient(socketPath);
    client.write(encode({ type: "attach", client: "tui" }));
    await waitFor(() => server.clientCount() === 1);

    const result = await listSessions();

    expect(result.listings[0]?.clients).toBe(1);

    client.destroy();
    await server.close();
  });

  test("the table reports the age of a session", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const id = "s-77777777";
    const socketPath = join(sessionsDir(), `${id}.sock`);
    const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    writeRecord(id, "aged@main", "/repo", createdAt);
    const server = await startSessionServer({ socketPath });

    const result = await listSessions();

    expect(result.listings[0]?.createdAt).toBe(createdAt);
    expect(result.text).toContain("AGE");
    expect(result.text).toContain("2h");

    await server.close();
  });

  test("a live socket that never answers status survives the sweep", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const id = "s-88888888";
    const socketPath = join(sessionsDir(), `${id}.sock`);
    const recordPath = join(sessionsDir(), `${id}.json`);

    writeRecord(id, "blocked@main", "/repo");
    const stopMuteServer = await startMuteServer(socketPath);

    const result = await listSessions();

    expect(result.swept).toEqual([]);
    expect(existsSync(socketPath)).toBe(true);
    expect(existsSync(recordPath)).toBe(true);

    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.label).toBe("blocked@main");
    expect(result.listings[0]?.clients).toBeNull();
    expect(result.text).toContain("?");

    await stopMuteServer();
  });

  test("the sweep leaves a muted session's flag and opt-out alone", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const id = "s-99999999";
    const socketPath = join(sessionsDir(), `${id}.sock`);
    const flagPath = join(sessionsDir(), `${id}.on`);
    const optOutPath = join(sessionsDir(), `${id}.off`);

    writeRecord(id, "muted@main", "/repo");
    writeFileSync(socketPath, "", "utf-8");
    writeFileSync(flagPath, "", "utf-8");
    writeFileSync(optOutPath, "", "utf-8");

    const swept = await sweepDeadSessions();

    expect(swept).toContain(id);
    expect(existsSync(socketPath)).toBe(false);
    expect(existsSync(flagPath)).toBe(true);
    expect(existsSync(optOutPath)).toBe(true);
  });

  test("one dead session is swept while a live neighbour keeps every file", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const deadId = "s-aaaaaaaa";
    const liveId = "s-bbbbbbbb";
    const deadSocket = join(sessionsDir(), `${deadId}.sock`);
    const liveSocket = join(sessionsDir(), `${liveId}.sock`);

    writeRecord(deadId, "dead@main", "/repo");
    writeRecord(liveId, "live@main", "/repo");
    writeFileSync(deadSocket, "", "utf-8");

    const server = await startSessionServer({ socketPath: liveSocket });

    const result = await listSessions();

    expect(result.swept).toEqual([deadId]);
    expect(existsSync(deadSocket)).toBe(false);
    expect(existsSync(join(sessionsDir(), `${deadId}.json`))).toBe(false);

    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.id).toBe(liveId);
    expect(existsSync(liveSocket)).toBe(true);
    expect(existsSync(join(sessionsDir(), `${liveId}.json`))).toBe(true);

    await server.close();
  });

  test("a sidecar with a non-string createdAt degrades instead of faking an age", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const id = "s-cccccccc";
    const socketPath = join(sessionsDir(), `${id}.sock`);

    writeFileSync(
      join(sessionsDir(), `${id}.json`),
      JSON.stringify({ label: "bogus", directory: "/repo", createdAt: 5 }),
      "utf-8",
    );

    const server = await startSessionServer({ socketPath });

    const result = await listSessions();

    expect(result.listings[0]?.label).toBe("unknown");
    expect(result.listings[0]?.createdAt).toBe("");
    expect(result.text).toContain("-");

    await server.close();
  });
});
