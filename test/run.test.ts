import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, beforeEach, afterEach } from "vitest";
import { runPair } from "../src/core/run";
import { DEFAULT_CONFIG } from "../src/core/config";
import type { PairConfig } from "../src/core/config";
import { enable } from "../src/core/state";
import type { Multiplexer, RunResult, PaneSize } from "../src/multiplexers/multiplexer.types";
import type { Editor, EditorContext, EditorLaunch } from "../src/editors/editor.types";

let xdgStateHome: string;
let originalXdgStateHome: string | undefined;
let originalHome: string | undefined;
let originalEditorOverride: string | undefined;
let originalVisual: string | undefined;
let originalEditor: string | undefined;
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

  originalEditor = process.env["EDITOR"];
  delete process.env["EDITOR"];

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

  if (originalEditor === undefined) {
    delete process.env["EDITOR"];
  } else {
    process.env["EDITOR"] = originalEditor;
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
