import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { sessionKey, sessionKeySocketPath, sessionKeyRecordPath } from "../src/core/state";
import { useIsolatedHome, useShortStateHome } from "./helpers/env";

const isolated = useIsolatedHome({
  clear: ["CLAUDE_CODE_SESSION_ID", "CODEX_SESSION_ID", "CODEX_THREAD_ID"],
});

useShortStateHome();

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const cliBundle = join(repoRoot, "dist", "cli.js");

const AGENT_SESSION_ID = "e2e-bootstrap-0000-1111-222222222222";
const WAIT_TIMEOUT_MS = 8000;
const POLL_MS = 10;

// index.ts runs on import and exits the process, so the dispatch chain is only reachable through the bundle.
beforeAll(() => {
  const built = spawnSync("node", [join(repoRoot, "scripts/build.mjs")], {
    cwd: repoRoot,
    encoding: "utf-8",
  });

  expect(built.status).toBe(0);
});

let workDir: string;
let watcher: ChildProcess | null = null;

beforeEach(() => {
  workDir = realpathSync(isolated.tempDir("pair-bootstrap-"));
});

afterEach(async () => {
  if (watcher !== null) {
    const done = new Promise<void>((resolveExit) => watcher?.once("exit", () => resolveExit()));
    watcher.kill("SIGKILL");
    await done;
    watcher = null;
  }
});

function runCli(args: string[], extra: Record<string, string> = {}) {
  return spawnSync("node", [cliBundle, ...args], {
    cwd: workDir,
    encoding: "utf-8",
    env: { ...process.env, ...extra },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

async function waitFor(label: string, ready: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;

  while (!ready()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }

    await sleep(POLL_MS);
  }
}

// The listing pads its columns, so the count is the fourth field of the row this session owns.
function watcherCount(listing: string, key: string): number | null {
  const row = listing.split("\n").find((line) => line.startsWith(key));

  if (row === undefined) {
    return null;
  }

  return Number(row.trim().split(/\s+/)[3]);
}

// The watcher never exits on its own, so the test starts it, drains its screen, and kills it in afterEach.
function startWatcher(args: string[]): ChildProcess {
  const child = spawn("node", [cliBundle, ...args], {
    cwd: workDir,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stdout?.resume();
  child.stderr?.resume();

  return child;
}

test("on inside a session, then sessions, then watch mints the session socket", async () => {
  const key = sessionKey(AGENT_SESSION_ID);

  const on = runCli(["on"], { CLAUDE_CODE_SESSION_ID: AGENT_SESSION_ID });

  expect(on.status).toBe(0);
  expect(on.stdout).toContain(`pair mode ON · ${key}`);

  const empty = runCli(["sessions"]);

  expect(empty.status).toBe(0);
  expect(empty.stdout).toContain("no pair-mode sessions");
  expect(existsSync(sessionKeySocketPath(key))).toBe(false);

  watcher = startWatcher(["watch", key]);

  await waitFor("the session socket", () => existsSync(sessionKeySocketPath(key)));
  await waitFor("the sidecar", () => existsSync(sessionKeyRecordPath(key)));

  const listed = runCli(["sessions"]);

  expect(listed.status).toBe(0);
  expect(listed.stdout).toContain(key);
  expect(listed.stdout).toContain("session");
});

test("watch on a live session id attaches as a viewer rather than failing", async () => {
  const key = sessionKey(AGENT_SESSION_ID);

  runCli(["on"], { CLAUDE_CODE_SESSION_ID: AGENT_SESSION_ID });

  watcher = startWatcher(["watch", key]);

  await waitFor("the session socket", () => existsSync(sessionKeySocketPath(key)));

  const viewer = startWatcher(["watch", key]);
  const exited: number[] = [];

  viewer.once("exit", (code) => exited.push(code ?? -1));

  await waitFor("the viewer to attach", () => watcherCount(runCli(["sessions"]).stdout, key) === 2);

  expect(exited).toEqual([]);

  viewer.kill("SIGKILL");
});

test("watch rejects a malformed session id and never binds a socket", () => {
  const report = runCli(["watch", "s-nothex"]);

  expect(report.status).toBe(1);
  expect(report.stderr).toContain("malformed session id: s-nothex");
  expect(existsSync(join(dirname(sessionKeySocketPath("s-00000000")), "s-nothex.sock"))).toBe(
    false,
  );
});

test("the session flag and the sessions directory stay readable by their owner alone", () => {
  const key = sessionKey(AGENT_SESSION_ID);

  runCli(["on"], { CLAUDE_CODE_SESSION_ID: AGENT_SESSION_ID });

  const flag = join(dirname(sessionKeySocketPath(key)), `${key}.on`);

  expect(statSync(flag).mode & 0o777).toBe(0o600);
  expect(statSync(dirname(flag)).mode & 0o777).toBe(0o700);
});
