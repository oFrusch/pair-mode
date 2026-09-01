import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, beforeAll, beforeEach, describe } from "vitest";
import { pairOn, pairOff, pairToggle, pairStatus, agentSessionId } from "../src/cli/toggle";
import { flagPath, sessionUrlPath, sessionKey, sessionFlagState, enable } from "../src/core/state";
import { useIsolatedHome } from "./helpers/env";

const isolated = useIsolatedHome();

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const cliBundle = join(repoRoot, "dist", "cli.js");

// Signalling this process would kill the test worker, so every link file names a pid that cannot exist.
const DEAD_PID = 2_147_483_600;

// A path that resolves to nothing, so a test that reaches the spawn would fail loudly rather than start a watcher.
const MISSING_CLI = "/does/not/exist.js";

// index.ts runs on import and exits the process, so the dispatch chain is only reachable through the bundle.
beforeAll(() => {
  const result = spawnSync("node", [join(repoRoot, "scripts/build.mjs")], {
    cwd: repoRoot,
    encoding: "utf-8",
  });

  expect(result.status).toBe(0);
});

function runCli(args: string[]) {
  return spawnSync("node", [cliBundle, ...args], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: process.env,
  });
}

let repoDir: string;

beforeEach(() => {
  repoDir = realpathSync(isolated.tempDir("pair-mode-repo-"));
});

function writeLink(directory: string, url: string, pid: number): string {
  const path = sessionUrlPath(directory);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ url, pid }), "utf-8");

  return path;
}

function isOn(directory: string): boolean {
  return existsSync(flagPath(directory));
}

test("toggling a directory that is off turns it on", async () => {
  expect(isOn(repoDir)).toBe(false);

  const message = await pairToggle(repoDir, MISSING_CLI, false);

  expect(message).toBe(`pair mode ON for ${repoDir}`);
  expect(isOn(repoDir)).toBe(true);
});

test("toggling a directory that is on turns it off", async () => {
  pairOn(repoDir);

  const message = await pairToggle(repoDir, MISSING_CLI, false);

  expect(message).toBe(`pair mode OFF for ${repoDir}`);
  expect(isOn(repoDir)).toBe(false);
});

test("two toggles return the directory to the state it started in", async () => {
  await pairToggle(repoDir, MISSING_CLI, false);
  await pairToggle(repoDir, MISSING_CLI, false);

  expect(isOn(repoDir)).toBe(false);

  pairOn(repoDir);

  await pairToggle(repoDir, MISSING_CLI, false);
  await pairToggle(repoDir, MISSING_CLI, false);

  expect(isOn(repoDir)).toBe(true);
});

test("toggling one directory leaves a sibling directory alone", async () => {
  const sibling = realpathSync(isolated.tempDir("pair-mode-sibling-"));
  pairOn(sibling);

  await pairToggle(repoDir, MISSING_CLI, false);

  expect(isOn(repoDir)).toBe(true);
  expect(isOn(sibling)).toBe(true);

  await pairToggle(sibling, MISSING_CLI, false);

  expect(isOn(repoDir)).toBe(true);
  expect(isOn(sibling)).toBe(false);
});

test("toggle --web takes the web path when pair mode is off, and reuses a published link", async () => {
  writeLink(repoDir, "http://127.0.0.1:9/r/existing", DEAD_PID);

  const message = await pairToggle(repoDir, MISSING_CLI, true);

  expect(message).toBe(`pair mode ON for ${repoDir}\nhttp://127.0.0.1:9/r/existing`);
  expect(isOn(repoDir)).toBe(true);
});

test("toggle --web never takes the web path when pair mode is turning off", async () => {
  pairOn(repoDir);
  const link = writeLink(repoDir, "http://127.0.0.1:9/r/existing", DEAD_PID);

  const message = await pairToggle(repoDir, MISSING_CLI, true);

  expect(message).toBe(`pair mode OFF for ${repoDir} (web watcher stopped)`);
  expect(message).not.toContain("http://");
  expect(isOn(repoDir)).toBe(false);
  expect(existsSync(link)).toBe(false);
});

test("toggle --web off then on reports the state twice without ever leaving the flag set", async () => {
  pairOn(repoDir);

  expect(await pairToggle(repoDir, MISSING_CLI, true)).toContain("OFF");

  writeLink(repoDir, "http://127.0.0.1:9/r/second", DEAD_PID);

  expect(await pairToggle(repoDir, MISSING_CLI, true)).toContain("http://127.0.0.1:9/r/second");
  expect(isOn(repoDir)).toBe(true);
});

test("pairOff on a directory that is already off stays off", () => {
  expect(pairOff(repoDir)).toBe(`pair mode OFF for ${repoDir}`);
  expect(isOn(repoDir)).toBe(false);
});

test("the toggle command flips pair mode for a directory named on the command line", () => {
  const first = runCli(["toggle", repoDir]);

  expect(first.status).toBe(0);
  expect(first.stdout.trim()).toBe(`pair mode ON for ${repoDir}`);
  expect(isOn(repoDir)).toBe(true);

  const second = runCli(["toggle", repoDir]);

  expect(second.status).toBe(0);
  expect(second.stdout.trim()).toBe(`pair mode OFF for ${repoDir}`);
  expect(isOn(repoDir)).toBe(false);
});

test("the toggle command reports an unknown flag the way on and off report one", () => {
  const commands = ["on", "off", "toggle"];

  const reports = commands.map((command) => runCli([command, "--bogus", repoDir]));

  reports.forEach((report, index) => {
    expect(report.status).toBe(1);
    expect(report.stderr).toContain(`unknown option for ${commands[index]}: --bogus`);
    expect(report.stderr).toContain("pair-mode <command> [directory]");
  });

  expect(isOn(repoDir)).toBe(false);
});

test("off rejects the --web flag that toggle accepts", () => {
  const report = runCli(["off", "--web", repoDir]);

  expect(report.status).toBe(1);
  expect(report.stderr).toContain("unknown option for off: --web");
});

test("the usage text names both toggle forms", () => {
  const report = runCli(["--help"]);

  expect(report.status).toBe(0);
  expect(report.stdout).toContain("toggle [dir]");
  expect(report.stdout).toContain("toggle --web [dir]");
});

describe("session-scoped toggling", () => {
  const agentId = "d95655de-eb7f-45e5-867d-9797a355353e";

  test("agentSessionId reads the Claude Code variable", () => {
    expect(agentSessionId({ CLAUDE_CODE_SESSION_ID: agentId })).toBe(agentId);
  });

  test("agentSessionId falls back to the Codex variables", () => {
    expect(agentSessionId({ CODEX_SESSION_ID: agentId })).toBe(agentId);
    expect(agentSessionId({ CODEX_THREAD_ID: agentId })).toBe(agentId);
  });

  test("agentSessionId returns null in a plain terminal", () => {
    expect(agentSessionId({})).toBeNull();
  });

  test("on with a key writes the session flag, not the directory flag", () => {
    const directory = isolated.tempDir("pair-scope-");
    const key = sessionKey(agentId);

    pairOn(directory, key);

    expect(sessionFlagState(key)).toBe("on");
    expect(existsSync(flagPath(directory))).toBe(false);
  });

  test("a bare off writes the session opt-out and spares the directory flag", () => {
    const directory = isolated.tempDir("pair-scope-off-");
    const key = sessionKey(agentId);

    enable(directory);
    pairOff(directory, key);

    expect(sessionFlagState(key)).toBe("off");
    expect(existsSync(flagPath(directory))).toBe(true);
  });

  test("off with no key clears the directory flag", () => {
    const directory = isolated.tempDir("pair-scope-dir-off-");

    enable(directory);
    pairOff(directory);

    expect(existsSync(flagPath(directory))).toBe(false);
  });

  test("toggle with a key flips the session tier only", async () => {
    const directory = isolated.tempDir("pair-scope-toggle-");
    const key = sessionKey(agentId);

    await pairToggle(directory, "", false, key);
    expect(sessionFlagState(key)).toBe("on");

    await pairToggle(directory, "", false, key);
    expect(sessionFlagState(key)).toBe("off");
  });

  test("status with a key reports the resolved state and names the key", () => {
    const directory = isolated.tempDir("pair-scope-status-");
    const key = sessionKey(agentId);

    pairOn(directory, key);

    const text = pairStatus(directory, key);

    expect(text).toContain("ON");
    expect(text).toContain(key);
  });
});
