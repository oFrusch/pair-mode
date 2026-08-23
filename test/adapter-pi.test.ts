import { mkdtempSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, beforeEach, afterEach } from "vitest";
import { enable } from "../src/core/state";
import { handleToolCall } from "../src/adapters/pi";
import type { RunPairFn } from "../src/adapters/pi";

let xdgStateHome: string;
let originalXdgStateHome: string | undefined;
let filePath: string;

beforeEach(() => {
  xdgStateHome = mkdtempSync(join(tmpdir(), "pair-mode-state-"));
  originalXdgStateHome = process.env["XDG_STATE_HOME"];
  process.env["XDG_STATE_HOME"] = xdgStateHome;

  const targetDir = realpathSync(mkdtempSync(join(tmpdir(), "pair-mode-target-")));
  filePath = join(targetDir, "example.ts");
  writeFileSync(filePath, "before\n", "utf-8");
  enable(targetDir);
});

afterEach(() => {
  if (originalXdgStateHome === undefined) {
    delete process.env["XDG_STATE_HOME"];
  } else {
    process.env["XDG_STATE_HOME"] = originalXdgStateHome;
  }
});

function denyingRunPair(reason: string): RunPairFn {
  return async () => ({ decision: "deny", reason });
}

function allowingRunPair(): RunPairFn {
  return async () => ({ decision: "allow" });
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
    return { decision: "allow" };
  };

  const result = await handleToolCall({ toolName: "bash", input: { command: "ls" } }, runPair);

  expect(result).toEqual({ block: false });
  expect(called).toBe(false);
});

test("a call for a directory pair mode has not enabled resolves block: false", async () => {
  const disabledDir = realpathSync(mkdtempSync(join(tmpdir(), "pair-mode-disabled-")));
  const disabledPath = join(disabledDir, "example.ts");
  writeFileSync(disabledPath, "before\n", "utf-8");

  const result = await handleToolCall(
    { toolName: "write", input: { path: disabledPath, content: "after\n" } },
    denyingRunPair("should not be reached"),
  );

  expect(result).toEqual({ block: false });
});
