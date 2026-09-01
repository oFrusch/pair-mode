import { mkdirSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { test, expect, beforeEach } from "vitest";
import { pairOn, pairOff, pairStatus, pairOnWeb, pairToggle } from "../src/cli/toggle";
import { flagPath, sessionFlagState, sessionKeyUrlPath, sessionUrlPath } from "../src/core/state";
import { runDoctor } from "../src/cli/doctor";
import { sessionKey, sessionKeySocketPath, sessionSocketPath } from "../src/core/state";
import { DEFAULT_CONFIG } from "../src/core/config";
import { useIsolatedHome } from "./helpers/env";
import type { SessionProbe } from "../src/cli/sessions";

const isolated = useIsolatedHome({
  clear: ["CLAUDE_CODE_SESSION_ID", "CODEX_SESSION_ID", "CODEX_THREAD_ID"],
});

let repoRoot: string;

beforeEach(() => {
  repoRoot = realpathSync(isolated.tempDir("pair-mode-repo-"));
});

const ANSWERED: SessionProbe = {
  status: "answered",
  state: { type: "state", clientCount: 1, waitingDepth: 0, lastAttachAt: null },
};

const REFUSED: SessionProbe = { status: "refused" };

const SILENT: SessionProbe = { status: "silent" };

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
  const report = await runDoctor({
    directory: repoRoot,
    config: { ...DEFAULT_CONFIG, transport: "pane" },
  });
  const session = report.checks.find((check) => check.name.startsWith("session:"));

  expect(session?.warnOnly).toBe(true);
  expect(session?.detail).toContain("transport is pane");
});

test("doctor reports a live watcher when the socket accepts a connection", async () => {
  const socket = sessionSocketPath(repoRoot);
  mkdirSync(dirname(socket), { recursive: true });
  writeFileSync(socket, "");

  const report = await runDoctor({
    directory: repoRoot,
    probeSession: () => Promise.resolve(ANSWERED),
  });
  const session = report.checks.find((check) => check.name.startsWith("session:"));

  expect(session?.passed).toBe(true);
  expect(session?.detail).toBe("a watcher is attached");
});

test("doctor removes a stale socket rather than naming rm", async () => {
  const directory = isolated.tempDir("pair-doctor-stale-");
  const socketPath = sessionSocketPath(directory);

  mkdirSync(dirname(socketPath), { recursive: true });
  writeFileSync(socketPath, "", "utf-8");

  const report = await runDoctor({
    directory,
    config: { ...DEFAULT_CONFIG, transport: "session" },
    probeSession: async () => REFUSED,
  });

  const session = report.checks.find((check) => check.name.startsWith("session:"));

  expect(session?.detail).toBe("removed a stale socket");
  expect(session?.detail).not.toContain("rm ");
  expect(existsSync(socketPath)).toBe(false);
});

test("doctor reports the session socket when the environment names an agent session", async () => {
  process.env["CLAUDE_CODE_SESSION_ID"] = "doctor-session";

  const sessionPath = sessionKeySocketPath(sessionKey("doctor-session"));
  mkdirSync(dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, "", "utf-8");

  const report = await runDoctor({
    directory: repoRoot,
    probeSession: () => Promise.resolve(ANSWERED),
  });
  const session = report.checks.find((check) => check.name.startsWith("session:"));

  expect(session?.name).toBe(`session: ${sessionPath}`);
});

test("doctor reports the directory socket when no session id is in the environment", async () => {
  const sessionPath = sessionKeySocketPath(sessionKey("doctor-session"));
  const directoryPath = sessionSocketPath(repoRoot);

  mkdirSync(dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, "", "utf-8");
  writeFileSync(directoryPath, "", "utf-8");

  const report = await runDoctor({
    directory: repoRoot,
    probeSession: () => Promise.resolve(ANSWERED),
  });
  const session = report.checks.find((check) => check.name.startsWith("session:"));

  expect(session?.name).toBe(`session: ${directoryPath}`);
});

test("doctor keeps a socket whose watcher connects but answers nothing", async () => {
  const socket = sessionSocketPath(repoRoot);
  mkdirSync(dirname(socket), { recursive: true });
  writeFileSync(socket, "");

  const report = await runDoctor({
    directory: repoRoot,
    config: { ...DEFAULT_CONFIG, transport: "session" },
    probeSession: async () => SILENT,
  });
  const session = report.checks.find((check) => check.name.startsWith("session:"));

  expect(session?.detail).toBe("a watcher is attached");
  expect(existsSync(socket)).toBe(true);
});

const AGENT_ID = "toggle-web-0000-1111-222222222222";

function writeSessionLink(key: string, url: string, pid: number): string {
  const path = sessionKeyUrlPath(key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ url, pid }), "utf-8");
  return path;
}

test("on --web inside a session writes the session flag, not the directory flag", async () => {
  const key = sessionKey(AGENT_ID);
  writeSessionLink(key, "http://127.0.0.1:9/r/session", DEAD_PID);

  const message = await pairOnWeb(repoRoot, "/does/not/exist.js", key);

  expect(message).toContain(`pair mode ON \u00b7 ${key}`);
  expect(message).toContain("http://127.0.0.1:9/r/session");
  expect(sessionFlagState(key)).toBe("on");
  expect(existsSync(flagPath(repoRoot))).toBe(false);
});

test("on --web inside a session never reuses a directory watcher's link", async () => {
  const key = sessionKey(AGENT_ID);
  writeLink(repoRoot, "http://127.0.0.1:9/r/directory", DEAD_PID);
  writeSessionLink(key, "http://127.0.0.1:9/r/session", DEAD_PID);

  const message = await pairOnWeb(repoRoot, "/does/not/exist.js", key);

  expect(message).toContain("http://127.0.0.1:9/r/session");
  expect(message).not.toContain("http://127.0.0.1:9/r/directory");
});

test("off inside a session stops that session's web watcher and spares the directory link", () => {
  const key = sessionKey(AGENT_ID);
  const sessionPath = writeSessionLink(key, "http://127.0.0.1:9/r/session", DEAD_PID);
  const directoryPath = writeLink(repoRoot, "http://127.0.0.1:9/r/directory", DEAD_PID);

  const message = pairOff(repoRoot, key);

  expect(message).toContain("web watcher stopped");
  expect(existsSync(sessionPath)).toBe(false);
  expect(existsSync(directoryPath)).toBe(true);
});

test("toggle inside a session reads the resolved state, so a directory flag turns it off", async () => {
  const key = sessionKey(AGENT_ID);
  pairOn(repoRoot);

  const message = await pairToggle(repoRoot, "/does/not/exist.js", false, key);

  expect(message).toContain(`pair mode OFF \u00b7 ${key}`);
  expect(sessionFlagState(key)).toBe("off");
  expect(existsSync(flagPath(repoRoot))).toBe(true);
});

test("toggle inside a session with no flag anywhere turns pair mode on for that session", async () => {
  const key = sessionKey(AGENT_ID);

  const message = await pairToggle(repoRoot, "/does/not/exist.js", false, key);

  expect(message).toContain(`pair mode ON \u00b7 ${key}`);
  expect(sessionFlagState(key)).toBe("on");
});

test("toggle --web inside a session honours the session key the plain path uses", async () => {
  const key = sessionKey(AGENT_ID);
  writeSessionLink(key, "http://127.0.0.1:9/r/session", DEAD_PID);

  const message = await pairToggle(repoRoot, "/does/not/exist.js", true, key);

  expect(message).toContain(`pair mode ON \u00b7 ${key}`);
  expect(sessionFlagState(key)).toBe("on");
  expect(existsSync(flagPath(repoRoot))).toBe(false);
});

test("doctor removes the sidecar with the stale socket, the way the sweep does", async () => {
  const socketPath = sessionSocketPath(repoRoot);
  const recordPath = socketPath.replace(/\.sock$/, ".json");

  mkdirSync(dirname(socketPath), { recursive: true });
  writeFileSync(socketPath, "", "utf-8");
  writeFileSync(recordPath, "{}", "utf-8");

  await runDoctor({
    directory: repoRoot,
    config: { ...DEFAULT_CONFIG, transport: "session" },
    probeSession: async () => REFUSED,
  });

  expect(existsSync(socketPath)).toBe(false);
  expect(existsSync(recordPath)).toBe(false);
});
