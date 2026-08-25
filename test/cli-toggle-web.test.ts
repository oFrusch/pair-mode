import { mkdtempSync, mkdirSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test, expect, beforeEach, afterEach } from "vitest";
import { pairOn, pairOff, pairStatus, pairOnWeb } from "../src/cli/toggle";
import { sessionUrlPath } from "../src/core/state";
import { runDoctor } from "../src/cli/doctor";
import { sessionSocketPath } from "../src/core/state";

let originalXdgStateHome: string | undefined;
let repoRoot: string;

beforeEach(() => {
  originalXdgStateHome = process.env["XDG_STATE_HOME"];
  process.env["XDG_STATE_HOME"] = mkdtempSync(join(tmpdir(), "pair-mode-state-"));
  repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "pair-mode-repo-")));
});

afterEach(() => {
  if (originalXdgStateHome === undefined) {
    delete process.env["XDG_STATE_HOME"];
  } else {
    process.env["XDG_STATE_HOME"] = originalXdgStateHome;
  }
});

// Signalling this process would kill the test worker, so every link file names a pid that cannot exist.
const DEAD_PID = 2_147_483_600;

function writeLink(directory: string, url: string, pid: number): string {
  const path = sessionUrlPath(directory);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ url, pid }), "utf-8");
  return path;
}

test("status names the web link when a watcher has published one", () => {
  pairOn(repoRoot);
  writeLink(repoRoot, "http://127.0.0.1:9/r/abc", DEAD_PID);

  expect(pairStatus(repoRoot)).toContain("http://127.0.0.1:9/r/abc");
});

test("status omits a link when no watcher has published one", () => {
  pairOn(repoRoot);

  expect(pairStatus(repoRoot)).toBe(`pair mode ON for ${repoRoot}`);
});

test("off removes the link file and reports that it stopped the web watcher", () => {
  pairOn(repoRoot);
  const path = writeLink(repoRoot, "http://127.0.0.1:9/r/abc", DEAD_PID);

  const message = pairOff(repoRoot);

  expect(message).toContain("web watcher stopped");
  expect(existsSync(path)).toBe(false);
});

test("off reports plainly when no web watcher is running", () => {
  pairOn(repoRoot);

  expect(pairOff(repoRoot)).toBe(`pair mode OFF for ${repoRoot}`);
});

test("on --web reuses a link a watcher already published rather than spawning another", async () => {
  writeLink(repoRoot, "http://127.0.0.1:9/r/existing", DEAD_PID);

  const message = await pairOnWeb(repoRoot, "/does/not/exist.js");

  expect(message).toContain("http://127.0.0.1:9/r/existing");
});

test("doctor warns rather than fails when no watcher is attached and the transport is pane", async () => {
  const report = await runDoctor({ directory: repoRoot });
  const session = report.checks.find((check) => check.name.startsWith("session:"));

  expect(session?.warnOnly).toBe(true);
  expect(session?.detail).toContain("transport is pane");
});

test("doctor reports a live watcher when the socket accepts a connection", async () => {
  const socket = sessionSocketPath(repoRoot);
  mkdirSync(dirname(socket), { recursive: true });
  writeFileSync(socket, "");

  const report = await runDoctor({ directory: repoRoot, probeSocket: () => Promise.resolve(true) });
  const session = report.checks.find((check) => check.name.startsWith("session:"));

  expect(session?.passed).toBe(true);
  expect(session?.detail).toBe("a watcher is attached");
});

test("doctor names the unlink command for a stale socket", async () => {
  const socket = sessionSocketPath(repoRoot);
  mkdirSync(dirname(socket), { recursive: true });
  writeFileSync(socket, "");

  const report = await runDoctor({
    directory: repoRoot,
    probeSocket: () => Promise.resolve(false),
  });
  const session = report.checks.find((check) => check.name.startsWith("session:"));

  expect(session?.passed).toBe(false);
  expect(session?.detail).toContain(`rm ${socket}`);
});
