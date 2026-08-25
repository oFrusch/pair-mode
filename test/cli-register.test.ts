import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test, expect, beforeEach } from "vitest";
import {
  claudeCodeSettingsPath,
  codexHooksPath,
  correctMultiEditMatchers,
  registerClaudeCode,
  registerCodex,
  piExtensionPath,
  piExtensionSource,
  registerPi,
} from "../src/cli/register";
import { useIsolatedHome } from "./helpers/env";

const isolated = useIsolatedHome();

let homeDir: string;
let installDir: string;

beforeEach(() => {
  homeDir = isolated.tempDir("pair-mode-home-");
  installDir = isolated.tempDir("pair-mode-install-");
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

test("the pi extension file re-exports the default factory, because pi loads only the default export", () => {
  const result = registerPi(homeDir, installDir);
  const written = readFileSync(piExtensionPath(homeDir), "utf-8");
  const target = join(installDir, "dist", "pi.js");

  expect(result.changed).toBe(true);
  expect(written).toContain(`export { default } from "${target}";`);
  expect(written).toContain(`export * from "${target}";`);
});

test("re-registering pi over an identical extension file reports no change", () => {
  registerPi(homeDir, installDir);

  expect(registerPi(homeDir, installDir).changed).toBe(false);
});

test("re-registering pi over a default-less extension file rewrites it", () => {
  const path = piExtensionPath(homeDir);
  const target = join(installDir, "dist", "pi.js");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `export * from "${target}";\n`, "utf-8");

  const result = registerPi(homeDir, installDir);

  expect(result.changed).toBe(true);
  expect(readFileSync(path, "utf-8")).toBe(piExtensionSource(target));
});

test("re-registering from a new install root rewrites the hook in place instead of adding a second one", () => {
  const otherInstallDir = isolated.tempDir("pair-mode-install-old-");
  registerClaudeCode(homeDir, otherInstallDir);

  const result = registerClaudeCode(homeDir, installDir);

  expect(result.changed).toBe(true);

  const written: unknown = JSON.parse(readFileSync(claudeCodeSettingsPath(homeDir), "utf-8"));
  const groups = (written as { hooks: { PreToolUse: { hooks: { command: string }[] }[] } }).hooks
    .PreToolUse;
  const commands = groups.flatMap((group) => group.hooks.map((entry) => entry.command));

  expect(commands).toEqual([join(installDir, "dist", "claude-code.js")]);
});

test("re-registering codex from a new install root leaves exactly one pair-mode hook", () => {
  const otherInstallDir = isolated.tempDir("pair-mode-install-old-");
  registerCodex(homeDir, otherInstallDir);
  registerCodex(homeDir, installDir);

  const written: unknown = JSON.parse(readFileSync(codexHooksPath(homeDir), "utf-8"));
  const groups = (written as { hooks: { PreToolUse: { hooks: { command: string }[] }[] } }).hooks
    .PreToolUse;
  const commands = groups.flatMap((group) => group.hooks.map((entry) => entry.command));

  expect(commands).toEqual([join(installDir, "dist", "codex.js")]);
});

test("a rewritten hook keeps unrelated hooks that share the same group", () => {
  const path = claudeCodeSettingsPath(homeDir);
  const otherInstallDir = isolated.tempDir("pair-mode-install-old-");
  mkdirSync(join(homeDir, ".claude"), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "Write|Edit|MultiEdit",
            hooks: [
              { type: "command", command: "some-other-hook" },
              { type: "command", command: join(otherInstallDir, "dist", "claude-code.js") },
            ],
          },
        ],
      },
    }),
    "utf-8",
  );

  registerClaudeCode(homeDir, installDir);

  const written: unknown = JSON.parse(readFileSync(path, "utf-8"));
  const groups = (written as { hooks: { PreToolUse: { hooks: { command: string }[] }[] } }).hooks
    .PreToolUse;
  const commands = groups.flatMap((group) => group.hooks.map((entry) => entry.command));

  expect(commands).toEqual(["some-other-hook", join(installDir, "dist", "claude-code.js")]);
});

test("registration reports malformed JSON through the error channel and leaves the file alone", () => {
  const path = claudeCodeSettingsPath(homeDir);
  mkdirSync(join(homeDir, ".claude"), { recursive: true });
  const original = "{ this is not json";
  writeFileSync(path, original, "utf-8");

  const result = registerClaudeCode(homeDir, installDir);

  expect(result.changed).toBe(false);
  expect(result.error).toContain(path);
  expect(result.error).toContain("not valid JSON");
  expect(readFileSync(path, "utf-8")).toBe(original);
  expect(existsSync(`${path}.pair-backup`)).toBe(false);
});

test("two writes to one file in a single run keep the original in the backup", () => {
  const path = codexHooksPath(homeDir);
  mkdirSync(join(homeDir, ".codex"), { recursive: true });
  const original = JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: "MultiEdit", hooks: [{ type: "command", command: "user-hook" }] }],
    },
  });
  writeFileSync(path, original, "utf-8");

  correctMultiEditMatchers(homeDir);
  registerCodex(homeDir, installDir);

  expect(readFileSync(`${path}.pair-backup`, "utf-8")).toBe(original);
});
