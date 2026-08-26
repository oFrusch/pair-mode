import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, beforeEach } from "vitest";
import { detectInstalls } from "../src/cli/detect";
import { runDoctor } from "../src/cli/doctor";
import { describeEphemeralRoot } from "../src/cli/install-root";
import { claudeCodeSettingsPath, codexHooksPath, registerOpencode } from "../src/cli/register";
import { RELEASED_CLIS, isReleased } from "../src/cli/released";
import { runSetup } from "../src/cli/setup";
import type { Prompter } from "../src/cli/setup";
import { configPath } from "../src/core/config";
import { useIsolatedHome } from "./helpers/env";

const isolated = useIsolatedHome({ clear: ["TMUX", "ZELLIJ"] });

let homeDir: string;
let installDir: string;

beforeEach(() => {
  homeDir = isolated.home;
  installDir = isolated.tempDir("pair-mode-install-");
});

// A prompter that records every call, so a test can prove the wizard never asked anything.
function countingPrompter(
  answers: string[],
): Prompter & { asked: string[]; closed: () => boolean } {
  const queue = [...answers];
  const asked: string[] = [];

  let didClose = false;

  return {
    asked,
    closed: (): boolean => didClose,
    question: async (prompt: string): Promise<string> => {
      asked.push(prompt);
      return queue.shift() ?? "";
    },
    close: (): void => {
      didClose = true;
    },
  };
}

test("describeEphemeralRoot flags a real npx cache path and cuts the cache at the _npx segment", () => {
  const result = describeEphemeralRoot("/Users/x/.npm/_npx/abc123/node_modules/pair-mode/dist");

  expect(result.ephemeral).toBe(true);
  expect(result.cache).toBe("/Users/x/.npm/_npx");
});

test("describeEphemeralRoot flags a pnpm dlx path", () => {
  const result = describeEphemeralRoot("/Users/x/Library/pnpm/_dlx/9f2c/node_modules/pair-mode");

  expect(result.ephemeral).toBe(true);
  expect(result.cache).toBe("/Users/x/Library/pnpm/_dlx");
});

test("describeEphemeralRoot flags a pnpm store path", () => {
  const result = describeEphemeralRoot("/Users/x/.local/share/.npm-store/v3/files/pair-mode");

  expect(result.ephemeral).toBe(true);
  expect(result.cache).toBe("/Users/x/.local/share/.npm-store");
});

test("describeEphemeralRoot leaves a normal global install alone", () => {
  const result = describeEphemeralRoot("/usr/local/lib/node_modules/pair-mode/dist");

  expect(result).toEqual({ ephemeral: false, cache: null });
});

test("the reported cache stops at the cache segment and never includes what follows it", () => {
  const result = describeEphemeralRoot("/Users/x/.npm/_npx/abc123/node_modules/pair-mode/dist");

  expect(result.cache).not.toContain("abc123");
  expect(result.cache).not.toContain("node_modules");
});

test("a directory merely named like a cache is not ephemeral", () => {
  expect(describeEphemeralRoot("/opt/my_npx_tools/pair-mode/dist")).toEqual({
    ephemeral: false,
    cache: null,
  });

  expect(describeEphemeralRoot("/opt/tools_dlx/pair-mode")).toEqual({
    ephemeral: false,
    cache: null,
  });

  expect(describeEphemeralRoot("/opt/x.npm-store-backup/pair-mode")).toEqual({
    ephemeral: false,
    cache: null,
  });
});

test("runSetup stops on an ephemeral install root without prompting or writing a thing", async () => {
  const prompter = countingPrompter(["micro", "tmux", "split", "claude-code,codex"]);

  const ephemeralRoot = join(homeDir, ".npm", "_npx", "abc123", "node_modules", "pair-mode");

  const result = await runSetup({
    prompter,
    homeDir: homeDir,
    installRoot: ephemeralRoot,
    resolvesOnPath: (command) => command === "tmux",
  });

  expect(result).toEqual({ changedFiles: [], stopped: true, doctorExitCode: 1 });

  expect(prompter.asked).toEqual([]);
  expect(prompter.closed()).toBe(true);

  expect(existsSync(claudeCodeSettingsPath(homeDir))).toBe(false);
  expect(existsSync(codexHooksPath(homeDir))).toBe(false);
  expect(existsSync(configPath(homeDir))).toBe(false);
  expect(readdirSync(homeDir)).toEqual([]);
});

test("runSetup does not stop on a normal install root", async () => {
  const prompter = countingPrompter(["micro", "tmux", "split", "claude-code,codex"]);

  const result = await runSetup({
    prompter,
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: (command) => command === "tmux",
  });

  expect(result.stopped).toBe(false);
  expect(prompter.asked.length).toBeGreaterThan(0);
  expect(result.changedFiles).toContain(claudeCodeSettingsPath(homeDir));
});

test("the CLI prompt offers only the released CLIs", async () => {
  const prompter = countingPrompter(["micro", "tmux", "split", ""]);

  await runSetup({
    prompter,
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: (command) => command === "tmux",
  });

  const cliPrompt = prompter.asked.find((prompt) => prompt.startsWith("Register with which CLIs"));

  expect(cliPrompt).toContain("claude-code,codex");
  expect(cliPrompt).not.toContain("opencode");
  expect(cliPrompt).not.toContain("pi)");
});

test("isReleased gates opencode and pi, and passes claude-code and codex", () => {
  expect(RELEASED_CLIS).toEqual(["claude-code", "codex"]);

  expect(isReleased("claude-code")).toBe(true);
  expect(isReleased("codex")).toBe(true);
  expect(isReleased("opencode")).toBe(false);
  expect(isReleased("pi")).toBe(false);
});

test("detectInstalls names claude-code and codex, and never opencode or pi", () => {
  const report = detectInstalls({
    resolvesOnPath: () => false,
    homeDir: homeDir,
    checkPairBundle: () => true,
  });

  const names = report.clis.map((cli) => cli.name);

  expect(names).toEqual(["claude-code", "codex"]);
});

test("doctor omits the opencode and pi hook checks on an unconfigured home", async () => {
  const report = await runDoctor({
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: () => false,
    openTty: () => {
      throw Object.assign(new Error("ENXIO"), { code: "ENXIO" });
    },
  });

  const names = report.checks.map((check) => check.name);

  expect(names).toContain("claude-code hook");
  expect(names).toContain("codex hook");
  expect(names).not.toContain("opencode hook");
  expect(names).not.toContain("pi hook");

  expect(report.text).not.toContain("opencode hook");
  expect(report.text).not.toContain("pi hook");
});

test("doctor reports the opencode hook once the user registered it by hand", async () => {
  registerOpencode(homeDir, installDir);

  const report = await runDoctor({
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: () => false,
    openTty: () => {
      throw Object.assign(new Error("ENXIO"), { code: "ENXIO" });
    },
  });

  const names = report.checks.map((check) => check.name);

  expect(names).toContain("opencode hook");
  expect(names).not.toContain("pi hook");

  // The dist entry point is absent here, so the surfaced check fails rather than passing quietly.
  const opencodeCheck = report.checks.find((check) => check.name === "opencode hook");
  expect(opencodeCheck?.passed).toBe(false);
});
