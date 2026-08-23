import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, beforeEach, afterEach } from "vitest";
import { runPair } from "../src/core/run";
import { DEFAULT_CONFIG } from "../src/core/config";
import type { PairConfig } from "../src/core/config";
import { enable } from "../src/core/state";
import type { Multiplexer, RunResult, PaneSize } from "../src/multiplexers/multiplexer.types";

let xdgStateHome: string;
let originalXdgStateHome: string | undefined;
let originalHome: string | undefined;
let originalEditorOverride: string | undefined;
let originalVisual: string | undefined;
let repoRoot: string;

beforeEach(() => {
  xdgStateHome = mkdtempSync(join(tmpdir(), "pair-mode-state-"));
  originalXdgStateHome = process.env["XDG_STATE_HOME"];
  process.env["XDG_STATE_HOME"] = xdgStateHome;

  originalHome = process.env["HOME"];
  process.env["HOME"] = mkdtempSync(join(tmpdir(), "pair-mode-home-"));

  originalEditorOverride = process.env["CC_PAIR_EDITOR"];
  delete process.env["CC_PAIR_EDITOR"];

  originalVisual = process.env["VISUAL"];
  delete process.env["VISUAL"];

  const scratch = mkdtempSync(join(tmpdir(), "pair-mode-repo-"));
  repoRoot = realpathSync(scratch);
  enable(repoRoot);
});

afterEach(() => {
  if (originalXdgStateHome === undefined) {
    delete process.env["XDG_STATE_HOME"];
  } else {
    process.env["XDG_STATE_HOME"] = originalXdgStateHome;
  }

  if (originalHome === undefined) {
    delete process.env["HOME"];
  } else {
    process.env["HOME"] = originalHome;
  }

  if (originalEditorOverride === undefined) {
    delete process.env["CC_PAIR_EDITOR"];
  } else {
    process.env["CC_PAIR_EDITOR"] = originalEditorOverride;
  }

  if (originalVisual === undefined) {
    delete process.env["VISUAL"];
  } else {
    process.env["VISUAL"] = originalVisual;
  }
});

function recordingMultiplexer(): { multiplexer: Multiplexer; calls: string[][] } {
  const calls: string[][] = [];

  const multiplexer: Multiplexer = {
    name: "none",

    available(): boolean {
      return true;
    },

    run(argv: string[], _size: PaneSize): RunResult {
      calls.push(argv);
      return { ok: true, detail: "" };
    },
  };

  return { multiplexer, calls };
}

function requestFor(filePath: string): { tool: string; filePath: string; before: string; after: string } {
  return { tool: "edit", filePath, before: "before", after: "after" };
}

test("run builds argv with an env prefix when the editor returns a non-empty env", async () => {
  const { multiplexer, calls } = recordingMultiplexer();
  const config: PairConfig = { ...DEFAULT_CONFIG, editor: "micro" };
  const filePath = join(repoRoot, "file.txt");

  await runPair(requestFor(filePath), config, { multiplexer });

  expect(calls).toHaveLength(1);
  const argv = calls[0];
  expect(argv).toBeDefined();
  expect(argv?.[0]).toBe("env");
  expect(argv?.[1]).toMatch(/^MICRO_CONFIG_HOME=/);
  expect(argv?.[2]).toBe("micro");
});

test("run builds argv with no env prefix when the editor returns an empty env", async () => {
  const { multiplexer, calls } = recordingMultiplexer();
  const config: PairConfig = { ...DEFAULT_CONFIG, editor: ["custom-editor", "--flag"] };
  const filePath = join(repoRoot, "file.txt");

  await runPair(requestFor(filePath), config, { multiplexer });

  expect(calls).toHaveLength(1);
  const argv = calls[0];
  expect(argv).toBeDefined();
  expect(argv?.[0]).toBe("custom-editor");
  expect(argv).not.toContain("env");
});
