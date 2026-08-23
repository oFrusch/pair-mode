import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, beforeEach } from "vitest";
import {
  claudeCodeSettingsPath,
  codexHooksPath,
  correctMultiEditMatchers,
  registerClaudeCode,
} from "../src/cli/register";

let homeDir: string;
let installDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "pair-mode-home-"));
  installDir = mkdtempSync(join(tmpdir(), "pair-mode-install-"));
});

test("registration refuses a settings file whose hooks value is an array, and does not touch the file", () => {
  const path = claudeCodeSettingsPath(homeDir);
  mkdirSync(join(homeDir, ".claude"), { recursive: true });
  const original = JSON.stringify({ hooks: ["not", "an", "object"] });
  writeFileSync(path, original, "utf-8");

  const result = registerClaudeCode(homeDir, installDir);

  expect(result.changed).toBe(false);
  expect(result.error).toBeDefined();
  expect(result.error).toContain(path);
  expect(result.error).toContain("hooks");
  expect(readFileSync(path, "utf-8")).toBe(original);
  expect(existsSync(`${path}.pair-backup`)).toBe(false);
});

test("registration refuses a settings file whose hooks.PreToolUse is an object, and does not touch the file", () => {
  const path = claudeCodeSettingsPath(homeDir);
  mkdirSync(join(homeDir, ".claude"), { recursive: true });
  const original = JSON.stringify({ hooks: { PreToolUse: { not: "an array" } } });
  writeFileSync(path, original, "utf-8");

  const result = registerClaudeCode(homeDir, installDir);

  expect(result.changed).toBe(false);
  expect(result.error).toBeDefined();
  expect(result.error).toContain(path);
  expect(result.error).toContain("PreToolUse");
  expect(readFileSync(path, "utf-8")).toBe(original);
  expect(existsSync(`${path}.pair-backup`)).toBe(false);
});

test("correcting a MultiEdit-only matcher drops the whole hook group instead of writing an empty matcher", () => {
  const path = codexHooksPath(homeDir);
  mkdirSync(join(homeDir, ".codex"), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: "MultiEdit", hooks: [{ type: "command", command: "some-hook" }] },
          { matcher: "Write|Edit|MultiEdit", hooks: [{ type: "command", command: "other-hook" }] },
        ],
      },
    }),
    "utf-8",
  );

  const result = correctMultiEditMatchers(homeDir);

  expect(result.changed).toBe(true);
  expect(result.note).toBeDefined();
  expect(result.note).toContain("MultiEdit");

  const written: unknown = JSON.parse(readFileSync(path, "utf-8"));
  const hooks = (written as { hooks: { PreToolUse: { matcher: string }[] } }).hooks.PreToolUse;

  expect(hooks).toHaveLength(1);
  expect(hooks[0]?.matcher).toBe("Write|Edit");
  expect(hooks.some((group) => group.matcher === "")).toBe(false);
});
