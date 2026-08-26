import { writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { test, expect, beforeEach } from "vitest";
import { enable } from "../src/core/state";
import { beforeToolExecute } from "../src/adapters/opencode";
import type { RunPairFn } from "../src/adapters/opencode";
import { useIsolatedHome } from "./helpers/env";

const isolated = useIsolatedHome();

let filePath: string;

beforeEach(() => {
  const targetDir = realpathSync(isolated.tempDir("pair-mode-target-"));
  filePath = join(targetDir, "example.ts");
  writeFileSync(filePath, "before\n", "utf-8");
  enable(targetDir);
});

function denyingRunPair(reason: string): RunPairFn {
  return async () => ({ decision: "deny", reason });
}

function allowingRunPair(): RunPairFn {
  return async () => ({ decision: "allow", reviewed: true });
}

function throwingRunPair(): RunPairFn {
  return async () => {
    throw new Error("boom");
  };
}

test("a deny verdict throws an Error whose message is the reason", async () => {
  await expect(
    beforeToolExecute(
      { tool: "write", sessionID: "s1", callID: "c1" },
      { args: { filePath, content: "after\n" } },
      denyingRunPair("nope"),
    ),
  ).rejects.toThrow("nope");
});

test("an allow verdict resolves without throwing", async () => {
  await expect(
    beforeToolExecute(
      { tool: "write", sessionID: "s1", callID: "c1" },
      { args: { filePath, content: "after\n" } },
      allowingRunPair(),
    ),
  ).resolves.toBeUndefined();
});

test("an edit tool call reaches runPair with translated old/new string args", async () => {
  await expect(
    beforeToolExecute(
      { tool: "edit", sessionID: "s1", callID: "c1" },
      { args: { filePath, oldString: "before", newString: "after" } },
      denyingRunPair("edit denied"),
    ),
  ).rejects.toThrow("edit denied");
});

test("a thrown internal error in runPair never propagates and resolves instead", async () => {
  await expect(
    beforeToolExecute(
      { tool: "write", sessionID: "s1", callID: "c1" },
      { args: { filePath, content: "after\n" } },
      throwingRunPair(),
    ),
  ).resolves.toBeUndefined();
});

test("an unrecognised tool resolves without calling runPair", async () => {
  let called = false;

  const runPair: RunPairFn = async () => {
    called = true;
    return { decision: "allow", reviewed: true };
  };

  await expect(
    beforeToolExecute(
      { tool: "bash", sessionID: "s1", callID: "c1" },
      { args: { command: "ls" } },
      runPair,
    ),
  ).resolves.toBeUndefined();

  expect(called).toBe(false);
});

test("a call for a directory pair mode has not enabled resolves without calling runPair", async () => {
  const disabledDir = realpathSync(isolated.tempDir("pair-mode-disabled-"));
  const disabledPath = join(disabledDir, "example.ts");
  writeFileSync(disabledPath, "before\n", "utf-8");

  await expect(
    beforeToolExecute(
      { tool: "write", sessionID: "s1", callID: "c1" },
      { args: { filePath: disabledPath, content: "after\n" } },
      denyingRunPair("should not be reached"),
    ),
  ).resolves.toBeUndefined();
});
