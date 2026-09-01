import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, describe } from "vitest";
import { useIsolatedHome, useShortStateHome } from "./helpers/env";
import { listSessions, sweepDeadSessions } from "../src/cli/sessions";
import { startSessionServer, encode } from "../src/transports/session";
import { sessionsDir } from "../src/core/state";

useIsolatedHome();

const SETTLE_MS = 50;
const DEFAULT_CREATED_AT = "2026-09-01T10:00:00.000Z";

function connectClient(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);

    socket.setEncoding("utf-8");
    socket.once("error", reject);
    socket.once("connect", () => resolve(socket));
  });
}

// A socket write has no completion callback, so the test yields long enough for the server to apply it.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
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
    await settle();

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
});
