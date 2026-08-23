import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, beforeEach, afterEach } from "vitest";
import {
  registerClaudeCode,
  registerCodex,
  claudeCodeSettingsPath,
  codexHooksPath,
  findMultiEditMatchers,
  correctMultiEditMatchers,
} from "../src/cli/register";
import { runSetup } from "../src/cli/setup";
import { pairOn, pairOff, pairStatus } from "../src/cli/toggle";
import type { Prompter } from "../src/cli/setup";
import { configPath, loadConfig, saveConfig } from "../src/core/config";
import type { PairConfig } from "../src/core/config";

let homeDir: string;
let installDir: string;
let originalHome: string | undefined;
let originalXdgConfigHome: string | undefined;
let originalXdgStateHome: string | undefined;
let originalTmux: string | undefined;
let originalZellij: string | undefined;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "pair-mode-home-"));
  installDir = mkdtempSync(join(tmpdir(), "pair-mode-install-"));

  originalHome = process.env["HOME"];
  process.env["HOME"] = homeDir;

  originalXdgConfigHome = process.env["XDG_CONFIG_HOME"];
  process.env["XDG_CONFIG_HOME"] = mkdtempSync(join(tmpdir(), "pair-mode-xdg-config-"));

  originalXdgStateHome = process.env["XDG_STATE_HOME"];
  process.env["XDG_STATE_HOME"] = mkdtempSync(join(tmpdir(), "pair-mode-xdg-state-"));

  originalTmux = process.env["TMUX"];
  delete process.env["TMUX"];

  originalZellij = process.env["ZELLIJ"];
  delete process.env["ZELLIJ"];
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env["HOME"];
  } else {
    process.env["HOME"] = originalHome;
  }

  if (originalXdgConfigHome === undefined) {
    delete process.env["XDG_CONFIG_HOME"];
  } else {
    process.env["XDG_CONFIG_HOME"] = originalXdgConfigHome;
  }

  if (originalXdgStateHome === undefined) {
    delete process.env["XDG_STATE_HOME"];
  } else {
    process.env["XDG_STATE_HOME"] = originalXdgStateHome;
  }

  if (originalTmux === undefined) {
    delete process.env["TMUX"];
  } else {
    process.env["TMUX"] = originalTmux;
  }

  if (originalZellij === undefined) {
    delete process.env["ZELLIJ"];
  } else {
    process.env["ZELLIJ"] = originalZellij;
  }
});

function scriptedPrompter(answers: string[]): Prompter {
  const queue = [...answers];

  return {
    question: async (): Promise<string> => queue.shift() ?? "",
    close: (): void => {},
  };
}

test("registration into an empty Claude Code settings.json produces a valid PreToolUse entry", () => {
  const result = registerClaudeCode(homeDir, installDir);

  expect(result.changed).toBe(true);

  const written: unknown = JSON.parse(readFileSync(claudeCodeSettingsPath(homeDir), "utf-8"));
  expect(written).toMatchObject({
    hooks: {
      PreToolUse: [
        {
          matcher: "Write|Edit|MultiEdit",
          hooks: [
            {
              type: "command",
              command: join(installDir, "dist", "claude-code.js"),
              timeout: 1800,
            },
          ],
        },
      ],
    },
  });
});

test("registration into a settings file that already carries unrelated hooks preserves them", () => {
  const path = claudeCodeSettingsPath(homeDir);
  mkdirSync(join(homeDir, ".claude"), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      model: "opus",
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "some-other-hook" }] }],
      },
    }),
    "utf-8",
  );

  registerClaudeCode(homeDir, installDir);

  const written: unknown = JSON.parse(readFileSync(path, "utf-8"));
  expect(written).toMatchObject({ model: "opus" });

  const hooks = (written as { hooks: { PreToolUse: unknown[] } }).hooks.PreToolUse;
  expect(hooks).toHaveLength(2);
  expect(hooks).toContainEqual({
    matcher: "Bash",
    hooks: [{ type: "command", command: "some-other-hook" }],
  });
});

test("a second registration is a no-op and reports the file as unchanged", () => {
  const first = registerClaudeCode(homeDir, installDir);
  expect(first.changed).toBe(true);

  const second = registerClaudeCode(homeDir, installDir);
  expect(second.changed).toBe(false);
  expect(second.backupPath).toBeNull();
});

test("registration creates a .pair-backup copy of the original file", () => {
  const path = claudeCodeSettingsPath(homeDir);
  mkdirSync(join(homeDir, ".claude"), { recursive: true });
  const original = JSON.stringify({ model: "opus" });
  writeFileSync(path, original, "utf-8");

  const result = registerClaudeCode(homeDir, installDir);

  expect(result.backupPath).toBe(`${path}.pair-backup`);
  expect(existsSync(`${path}.pair-backup`)).toBe(true);
  expect(readFileSync(`${path}.pair-backup`, "utf-8")).toBe(original);
});

test("a Codex hooks file carrying MultiEdit is detected, and correcting it removes the token", () => {
  const path = codexHooksPath(homeDir);
  mkdirSync(join(homeDir, ".codex"), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: "Write|Edit|MultiEdit", hooks: [{ type: "command", command: "some-hook" }] },
        ],
      },
    }),
    "utf-8",
  );

  const bad = findMultiEditMatchers(homeDir);
  expect(bad).toEqual(["Write|Edit|MultiEdit"]);

  const result = correctMultiEditMatchers(homeDir);
  expect(result.changed).toBe(true);
  expect(result.backupPath).toBe(`${path}.pair-backup`);

  const written: unknown = JSON.parse(readFileSync(path, "utf-8"));
  const hooks = (written as { hooks: { PreToolUse: { matcher: string }[] } }).hooks.PreToolUse;
  expect(hooks[0]?.matcher).toBe("Write|Edit");

  expect(findMultiEditMatchers(homeDir)).toEqual([]);
});

test("registerCodex writes the apply_patch|Edit|Write matcher, not MultiEdit", () => {
  const result = registerCodex(homeDir, installDir);
  expect(result.changed).toBe(true);

  const written: unknown = JSON.parse(readFileSync(codexHooksPath(homeDir), "utf-8"));
  expect(written).toMatchObject({
    hooks: {
      PreToolUse: [
        {
          matcher: "apply_patch|Edit|Write",
          hooks: [
            { type: "command", command: join(installDir, "dist", "codex.js"), timeout: 1800 },
          ],
        },
      ],
    },
  });
});

test("toggle on then status reports ON, and toggle off then status reports OFF", () => {
  const targetDir = mkdtempSync(join(tmpdir(), "pair-mode-target-"));

  expect(pairStatus(targetDir)).toBe(`pair mode OFF for ${targetDir}`);

  expect(pairOn(targetDir)).toBe(`pair mode ON for ${targetDir}`);
  expect(pairStatus(targetDir)).toBe(`pair mode ON for ${targetDir}`);

  expect(pairOff(targetDir)).toBe(`pair mode OFF for ${targetDir}`);
  expect(pairStatus(targetDir)).toBe(`pair mode OFF for ${targetDir}`);
});

test("runSetup drives a full flow from scripted answers and registers the selected CLIs", async () => {
  const prompter = scriptedPrompter([
    "micro", // editor
    "tmux", // multiplexer
    "split", // layout
    "claude-code,codex", // CLIs to register
  ]);

  const result = await runSetup({
    prompter,
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: (command) => command === "tmux",
  });

  expect(result.stopped).toBe(false);
  expect(existsSync(claudeCodeSettingsPath(homeDir))).toBe(true);
  expect(existsSync(codexHooksPath(homeDir))).toBe(true);
  expect(result.changedFiles).toContain(claudeCodeSettingsPath(homeDir));
  expect(result.changedFiles).toContain(codexHooksPath(homeDir));
});

test("runSetup warns and stops when no multiplexer is found and Claude Code is selected", async () => {
  const prompter = scriptedPrompter([
    "micro", // editor
    "none", // multiplexer
    "split", // layout
    "claude-code", // CLIs to register
    "", // stop here? default yes
  ]);

  const result = await runSetup({
    prompter,
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: () => false,
  });

  expect(result.stopped).toBe(true);
  expect(existsSync(claudeCodeSettingsPath(homeDir))).toBe(false);
});

test("runSetup honours options.homeDir for the config path, not the process's real home", async () => {
  const previousXdgConfigHome = process.env["XDG_CONFIG_HOME"];
  delete process.env["XDG_CONFIG_HOME"];

  try {
    const prompter = scriptedPrompter(["micro", "tmux", "split", ""]);

    await runSetup({
      prompter,
      homeDir: homeDir,
      installRoot: installDir,
      resolvesOnPath: (command) => command === "tmux",
    });

    const expectedPath = join(homeDir, ".config", "pair-mode", "config.json");
    expect(existsSync(expectedPath)).toBe(true);
  } finally {
    if (previousXdgConfigHome === undefined) {
      delete process.env["XDG_CONFIG_HOME"];
    } else {
      process.env["XDG_CONFIG_HOME"] = previousXdgConfigHome;
    }
  }
});

test("a re-run backs up the existing config and preserves fields the wizard never asks about", async () => {
  const configFilePath = configPath(homeDir);
  const customized: PairConfig = {
    editor: "nano",
    multiplexer: "tmux",
    layout: "split",
    context: 9,
    minFold: 7,
    pane: { width: "70%", height: "60%" },
    theme: { add: "#111111", del: "#222222", fold: "#333333" },
    trace: true,
  };
  saveConfig(customized, configFilePath);

  const prompter = scriptedPrompter(["micro", "tmux", "split", ""]);

  const result = await runSetup({
    prompter,
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: (command) => command === "tmux",
  });

  expect(existsSync(`${configFilePath}.pair-backup`)).toBe(true);
  expect(JSON.parse(readFileSync(`${configFilePath}.pair-backup`, "utf-8"))).toMatchObject({
    editor: "nano",
  });
  expect(result.changedFiles).toContain(configFilePath);

  const written = loadConfig(configFilePath).config;
  expect(written.editor).toBe("micro");
  expect(written.context).toBe(9);
  expect(written.minFold).toBe(7);
  expect(written.pane).toEqual({ width: "70%", height: "60%" });
  expect(written.theme).toEqual({ add: "#111111", del: "#222222", fold: "#333333" });
  expect(written.trace).toBe(true);
});
