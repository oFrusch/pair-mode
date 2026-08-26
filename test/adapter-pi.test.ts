import { writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { test, expect, beforeEach, describe } from "vitest";
import { enable } from "../src/core/state";
import { handleToolCall } from "../src/adapters/pi";
import type { RunPairFn } from "../src/adapters/pi";
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

test("a deny verdict returns block: true with the reason", async () => {
  const result = await handleToolCall(
    { toolName: "write", input: { path: filePath, content: "after\n" } },
    denyingRunPair("nope"),
  );

  expect(result).toEqual({ block: true, reason: "nope" });
});

test("an allow verdict returns block: false", async () => {
  const result = await handleToolCall(
    { toolName: "write", input: { path: filePath, content: "after\n" } },
    allowingRunPair(),
  );

  expect(result).toEqual({ block: false });
});

test("an edit tool call reaches runPair with translated old/new text", async () => {
  const result = await handleToolCall(
    {
      toolName: "edit",
      input: { path: filePath, edits: [{ oldText: "before", newText: "after" }] },
    },
    denyingRunPair("edit denied"),
  );

  expect(result).toEqual({ block: true, reason: "edit denied" });
});

test("an edit tool call with one malformed item drops the whole call, not just that item", async () => {
  const result = await handleToolCall(
    {
      toolName: "edit",
      input: {
        path: filePath,
        edits: [{ oldText: "before", newText: "after" }, { oldText: "before" }],
      },
    },
    denyingRunPair("should not run"),
  );

  expect(result).toEqual({ block: false });
});

test("a thrown internal error in runPair never propagates and resolves block: false", async () => {
  await expect(
    handleToolCall(
      { toolName: "write", input: { path: filePath, content: "after\n" } },
      throwingRunPair(),
    ),
  ).resolves.toEqual({ block: false });
});

test("an unrecognised tool name resolves block: false without calling runPair", async () => {
  let called = false;

  const runPair: RunPairFn = async () => {
    called = true;
    return { decision: "allow", reviewed: true };
  };

  const result = await handleToolCall({ toolName: "bash", input: { command: "ls" } }, runPair);

  expect(result).toEqual({ block: false });
  expect(called).toBe(false);
});

test("a call for a directory pair mode has not enabled resolves block: false", async () => {
  const disabledDir = realpathSync(isolated.tempDir("pair-mode-disabled-"));
  const disabledPath = join(disabledDir, "example.ts");
  writeFileSync(disabledPath, "before\n", "utf-8");

  const result = await handleToolCall(
    { toolName: "write", input: { path: disabledPath, content: "after\n" } },
    denyingRunPair("should not be reached"),
  );

  expect(result).toEqual({ block: false });
});

test("the module default export is the factory pi calls, and it registers both hooks", async () => {
  const module = await import("../src/adapters/pi");
  const events: string[] = [];
  const commands: string[] = [];

  expect(typeof module.default).toBe("function");

  module.default({
    on: (event) => {
      events.push(event);
    },
    registerCommand: (name) => {
      commands.push(name);
    },
  });

  expect(events).toEqual(["tool_call"]);
  expect(commands).toEqual(["pair"]);
});

describe("runPairCommand", () => {
  let directory: string;

  beforeEach(() => {
    directory = isolated.tempDir("pair-pi-cmd-");
  });

  test("on then status reports ON, off then status reports OFF", async () => {
    const { runPairCommand } = await import("../src/adapters/pi");

    expect(runPairCommand("on", directory)).toContain("ON");
    expect(runPairCommand("status", directory)).toContain("ON");
    expect(runPairCommand("off", directory)).toContain("OFF");
    expect(runPairCommand("", directory)).toContain("OFF");
  });

  test("an unknown action names the valid ones and changes nothing", async () => {
    const { runPairCommand } = await import("../src/adapters/pi");

    runPairCommand("on", directory);
    const message = runPairCommand("sideways", directory);

    expect(message).toContain("on, off, or status");
    expect(runPairCommand("status", directory)).toContain("ON");
  });
});
