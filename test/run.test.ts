import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, beforeEach } from "vitest";
import { runPair } from "../src/core/run";
import { DEFAULT_CONFIG } from "../src/core/config";
import type { PairConfig } from "../src/core/config";
import { enable } from "../src/core/state";
import type { Multiplexer, RunResult, PaneSize } from "../src/multiplexers/multiplexer.types";
import type { Editor, EditorContext, EditorLaunch } from "../src/editors/editor.types";
import { useIsolatedHome } from "./helpers/env";

const isolated = useIsolatedHome({ clear: ["CC_PAIR_EDITOR", "VISUAL", "EDITOR"] });

let repoRoot: string;

beforeEach(() => {
  repoRoot = realpathSync(isolated.tempDir("pair-mode-repo-"));
  enable(repoRoot);
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

function requestFor(filePath: string): {
  tool: string;
  filePath: string;
  before: string;
  after: string;
} {
  return { tool: "edit", filePath, before: "before", after: "after" };
}

function resultFileEditor(onPrepare: (context: EditorContext) => void): Editor {
  return {
    name: "custom",
    collectMode: "result-file",

    available(): boolean {
      return true;
    },

    bufferSuffix(): string {
      return ".diff";
    },

    headerHint(): string[] {
      return [];
    },

    prepare(context: EditorContext): EditorLaunch {
      onPrepare(context);
      return { argv: ["fake-editor"], env: {} };
    },
  };
}

function multiplexerRunningAt(action: () => void): Multiplexer {
  return {
    name: "none",

    available(): boolean {
      return true;
    },

    run(): RunResult {
      action();
      return { ok: true, detail: "" };
    },
  };
}

test("a result-file editor whose result file holds two questions produces a deny verdict naming both", async () => {
  let resultPath = "";
  const editor = resultFileEditor((context) => {
    resultPath = context.resultFile;
  });

  const multiplexer = multiplexerRunningAt(() => {
    writeFileSync(
      resultPath,
      JSON.stringify({
        questions: [
          { line: 1, code: "a", text: "why a?" },
          { line: 2, code: "b", text: "why b?" },
        ],
      }),
      "utf-8",
    );
  });

  const config: PairConfig = { ...DEFAULT_CONFIG, editor: ["fake-editor"] };
  const filePath = join(repoRoot, "file.txt");

  const verdict = await runPair(requestFor(filePath), config, { multiplexer, editor });

  expect(verdict.decision).toBe("deny");
  if (verdict.decision === "deny") {
    expect(verdict.reason).toContain("why a?");
    expect(verdict.reason).toContain("why b?");
  }
});

test("a result-file editor that writes no result file produces an allow, reviewed verdict", async () => {
  const editor = resultFileEditor(() => {});
  const multiplexer = multiplexerRunningAt(() => {});
  const config: PairConfig = { ...DEFAULT_CONFIG, editor: ["fake-editor"] };
  const filePath = join(repoRoot, "file.txt");

  const verdict = await runPair(requestFor(filePath), config, { multiplexer, editor });

  expect(verdict).toEqual({ decision: "allow", reviewed: true });
});

test("a buffer-diff editor still collects through the saved buffer", async () => {
  const multiplexer: Multiplexer = {
    name: "none",

    available(): boolean {
      return true;
    },

    run(argv: string[]): RunResult {
      const rightFile = argv.at(-1) ?? "";
      const original = readFileSync(rightFile, "utf-8");
      writeFileSync(rightFile, `${original}why this line?\n`, "utf-8");
      return { ok: true, detail: "" };
    },
  };

  const config: PairConfig = { ...DEFAULT_CONFIG, editor: "micro" };
  const filePath = join(repoRoot, "file.txt");

  const verdict = await runPair(requestFor(filePath), config, { multiplexer });

  expect(verdict.decision).toBe("deny");
  if (verdict.decision === "deny") {
    expect(verdict.reason).toContain("why this line?");
  }
});

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
