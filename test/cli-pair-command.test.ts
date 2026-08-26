import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test, expect, beforeEach } from "vitest";
import { runDoctor } from "../src/cli/doctor";
import {
  isPairCommandRegistered,
  pairCommandPath,
  pairCommandSource,
  registerClaudeCode,
  registerPairCommand,
} from "../src/cli/register";
import type { CliName } from "../src/cli/register";
import { useIsolatedHome } from "./helpers/env";

const isolated = useIsolatedHome();

const ALL_CLIS: CliName[] = ["claude-code", "codex", "opencode", "pi"];

const EXPECTED_SEGMENTS: { cli: CliName; segments: string[] }[] = [
  { cli: "claude-code", segments: [".claude", "commands", "pair.md"] },
  { cli: "codex", segments: [".codex", "prompts", "pair.md"] },
  { cli: "opencode", segments: [".config", "opencode", "commands", "pair.md"] },
  { cli: "pi", segments: [".pi", "agent", "skills", "pair", "SKILL.md"] },
];

let homeDir: string;
let installDir: string;

beforeEach(() => {
  homeDir = isolated.home;
  installDir = isolated.tempDir("pair-mode-install-");
});

test("each CLI reads the pair command from its own path under the home directory", () => {
  EXPECTED_SEGMENTS.forEach(({ cli, segments }) => {
    expect(pairCommandPath(homeDir, cli)).toBe(join(homeDir, ...segments));
  });
});

test("registering the pair command writes the file each CLI reads", () => {
  EXPECTED_SEGMENTS.forEach(({ cli, segments }) => {
    const result = registerPairCommand(homeDir, cli);

    expect(result.changed).toBe(true);
    expect(result.path).toBe(join(homeDir, ...segments));
    expect(existsSync(result.path)).toBe(true);
    expect(readFileSync(result.path, "utf-8")).toBe(pairCommandSource(cli));
  });
});

test("every command file opens and closes its front matter with a delimiter line", () => {
  ALL_CLIS.forEach((cli) => {
    const lines = pairCommandSource(cli).split("\n");
    const closing = lines.indexOf("---", 1);

    expect(lines[0]).toBe("---");
    expect(closing).toBeGreaterThan(1);

    const frontMatter = lines.slice(1, closing);

    expect(frontMatter.length).toBeGreaterThan(0);
    frontMatter.forEach((line) => expect(line).toMatch(/^[a-z-]+: \S/));

    // The body must carry the command itself, not front matter alone.
    expect(lines.slice(closing + 1).join("\n")).toContain("pair-mode");
  });
});

test("every command file describes the toggle in its front matter", () => {
  ALL_CLIS.forEach((cli) => {
    expect(pairCommandSource(cli)).toContain("description: Toggle pair mode.");
  });
});

test("the claude-code command declares the allowed tools claude-code requires", () => {
  const source = pairCommandSource("claude-code");

  expect(source).toContain("allowed-tools: Bash(pair-mode:*)");
  expect(source).not.toContain("name: pair");
});

test("the pi skill carries the name key pi loads the skill by", () => {
  const source = pairCommandSource("pi");
  const lines = source.split("\n");

  expect(lines[1]).toBe("name: pair");
});

test("the codex command hints at its arguments, and the pi skill reads the action from the message", () => {
  expect(pairCommandSource("codex")).toContain("argument-hint: on | off | status");

  // pi substitutes no $ARGUMENTS, so the skill body must tell the agent where the action comes from.
  expect(pairCommandSource("pi")).not.toContain("$ARGUMENTS");
  expect(pairCommandSource("pi")).toContain("Read the action from the user's message");
});

test("each command body names that CLI's own write tools", () => {
  expect(pairCommandSource("claude-code")).toContain("Write, Edit, and MultiEdit");
  expect(pairCommandSource("codex")).toContain("apply_patch, Write, and Edit");
  expect(pairCommandSource("opencode")).toContain("write, edit, and patch");
  expect(pairCommandSource("pi")).toContain("write and edit");

  // Codex has no MultiEdit alias, so naming it there would point the agent at a tool it cannot call.
  expect(pairCommandSource("codex")).not.toContain("MultiEdit");
});

test("re-registering over an identical command file reports no change and writes no backup", () => {
  ALL_CLIS.forEach((cli) => {
    const first = registerPairCommand(homeDir, cli);
    const second = registerPairCommand(homeDir, cli);

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.backupPath).toBeNull();
    expect(existsSync(`${first.path}.pair-backup`)).toBe(false);
  });
});

test("a user-edited command file is backed up and rewritten", () => {
  const path = pairCommandPath(homeDir, "claude-code");
  const original = "---\ndescription: my own command\n---\n\nDo something else.\n";
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, original, "utf-8");

  const result = registerPairCommand(homeDir, "claude-code");

  expect(result.changed).toBe(true);
  expect(result.backupPath).toBe(`${path}.pair-backup`);
  expect(readFileSync(`${path}.pair-backup`, "utf-8")).toBe(original);
  expect(readFileSync(path, "utf-8")).toBe(pairCommandSource("claude-code"));
});

test("a missing command file is not registered", () => {
  ALL_CLIS.forEach((cli) => {
    expect(isPairCommandRegistered(pairCommandPath(homeDir, cli))).toBe(false);
  });
});

test("a command file that never mentions pair-mode is not registered", () => {
  const path = pairCommandPath(homeDir, "codex");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "---\ndescription: someone else's command\n---\n\nDo nothing.\n", "utf-8");

  expect(isPairCommandRegistered(path)).toBe(false);

  registerPairCommand(homeDir, "codex");

  expect(isPairCommandRegistered(path)).toBe(true);
});

test("doctor reports the /pair command check only for a CLI whose hook is registered", async () => {
  registerClaudeCode(homeDir, installDir);
  registerPairCommand(homeDir, "claude-code");

  const report = await runDoctor({
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: () => true,
    openTty: () => {
      throw Object.assign(new Error("ENXIO"), { code: "ENXIO" });
    },
  });

  const commandChecks = report.checks
    .filter((check) => check.name.endsWith("/pair command"))
    .map((check) => check.name);

  expect(commandChecks).toEqual(["claude-code /pair command"]);
});

test("doctor warns, and does not fail, when a registered CLI has no /pair command", async () => {
  registerClaudeCode(homeDir, installDir);

  const report = await runDoctor({
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: () => true,
    openTty: () => {
      throw Object.assign(new Error("ENXIO"), { code: "ENXIO" });
    },
  });

  const commandCheck = report.checks.find((check) => check.name === "claude-code /pair command");

  expect(commandCheck?.passed).toBe(false);
  expect(commandCheck?.warnOnly).toBe(true);
  expect(report.text).toContain("[WARN] claude-code /pair command");
  expect(report.text).not.toContain("[FAIL] claude-code /pair command");
});

test("doctor passes the /pair command check once the command is installed", async () => {
  registerClaudeCode(homeDir, installDir);
  const path = registerPairCommand(homeDir, "claude-code").path;

  const report = await runDoctor({
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: () => true,
    openTty: () => {
      throw Object.assign(new Error("ENXIO"), { code: "ENXIO" });
    },
  });

  const commandCheck = report.checks.find((check) => check.name === "claude-code /pair command");

  expect(commandCheck?.passed).toBe(true);
  expect(commandCheck?.detail).toContain(path);
});
