import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, beforeEach } from "vitest";
import { splitLines } from "../src/helpers/splitLines";
import { resultFilePath } from "../src/helpers/resultFilePath";
import { resolveTransport, createPaneTransport } from "../src/transports";
import type { EditRequest, ReviewTransport, ReviewOutcome } from "../src/transports";
import type { Editor, EditorContext, EditorLaunch } from "../src/editors/editor.types";
import type { Multiplexer, RunResult } from "../src/multiplexers/multiplexer.types";
import { runPair } from "../src/core/run";
import { DEFAULT_CONFIG } from "../src/core/config";
import type { PairConfig } from "../src/core/config";
import { enable, stateDir } from "../src/core/state";
import { useIsolatedHome } from "./helpers/env";

const isolated = useIsolatedHome({ clear: ["CC_PAIR_EDITOR", "VISUAL", "EDITOR"] });

let repoRoot: string;

beforeEach(() => {
  repoRoot = realpathSync(isolated.tempDir("pair-mode-repo-"));
  enable(repoRoot);
});

function requestFor(filePath: string): EditRequest {
  return { tool: "edit", filePath, before: "before", after: "after" };
}

interface FakeTransport {
  transport: ReviewTransport;
  reviewCount(): number;
}

function fakeTransport(outcome: ReviewOutcome): FakeTransport {
  let reviews = 0;

  const transport: ReviewTransport = {
    name: "pane",

    async review(): Promise<ReviewOutcome> {
      reviews += 1;
      return outcome;
    },
  };

  return { transport, reviewCount: () => reviews };
}

test("splitLines drops a single trailing empty element left by a trailing newline", () => {
  expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
});

test("splitLines keeps every line when there is no trailing newline", () => {
  expect(splitLines("a\nb")).toEqual(["a", "b"]);
});

test("splitLines on an empty string yields an empty array", () => {
  expect(splitLines("")).toEqual([]);
});

test("splitLines on a text of only a newline yields one empty-string line", () => {
  expect(splitLines("\n")).toEqual([""]);
});

test("resultFilePath returns a pair-result path inside the OS tmpdir", () => {
  const path = resultFilePath();

  expect(path.startsWith(tmpdir())).toBe(true);
  expect(path).toMatch(/pair-result-[0-9a-f]{12}\.json$/);
});

test("resultFilePath is distinct across two calls", () => {
  const first = resultFilePath();
  const second = resultFilePath();

  expect(first).not.toBe(second);
});

test("resolveTransport returns the pane transport", () => {
  const transport = resolveTransport(DEFAULT_CONFIG, {});

  expect(transport.name).toBe("pane");
});

test("runPair allows without review when the transport reports it could not present the review", async () => {
  const { transport } = fakeTransport({ reviewed: false, detail: "boom" });
  const config: PairConfig = { ...DEFAULT_CONFIG };
  const filePath = join(repoRoot, "file.txt");

  const verdict = await runPair(requestFor(filePath), config, { transport });

  expect(verdict).toEqual({ decision: "allow", reviewed: false, reason: "boom" });
});

test("runPair allows, reviewed, when the transport reports no questions", async () => {
  const { transport } = fakeTransport({ reviewed: true, questions: [] });
  const config: PairConfig = { ...DEFAULT_CONFIG };
  const filePath = join(repoRoot, "file.txt");

  const verdict = await runPair(requestFor(filePath), config, { transport });

  expect(verdict).toEqual({ decision: "allow", reviewed: true });
});

test("runPair denies with a reason naming the question when the transport reports one", async () => {
  const { transport } = fakeTransport({
    reviewed: true,
    questions: [{ line: 2, code: "x", text: "why?" }],
  });
  const config: PairConfig = { ...DEFAULT_CONFIG };
  const filePath = join(repoRoot, "file.txt");

  const verdict = await runPair(requestFor(filePath), config, { transport });

  expect(verdict.decision).toBe("deny");
  if (verdict.decision === "deny") {
    expect(verdict.reason).toContain("why?");
  }
});

test("runPair never consults the transport when before equals after", async () => {
  const { transport, reviewCount } = fakeTransport({ reviewed: true, questions: [] });
  const config: PairConfig = { ...DEFAULT_CONFIG };
  const filePath = join(repoRoot, "file.txt");
  const request: EditRequest = { tool: "edit", filePath, before: "same", after: "same" };

  await runPair(request, config, { transport });

  expect(reviewCount()).toBe(0);
});

test("runPair never consults the transport when the directory is not enabled", async () => {
  const { transport, reviewCount } = fakeTransport({ reviewed: true, questions: [] });
  const config: PairConfig = { ...DEFAULT_CONFIG };
  const otherRepo = realpathSync(isolated.tempDir("pair-mode-other-repo-"));
  const filePath = join(otherRepo, "file.txt");

  await runPair(requestFor(filePath), config, { transport });

  expect(reviewCount()).toBe(0);
});

interface RecordingEditor {
  editor: Editor;
  configDirs(): string[];
}

// prepare() writes a real file so a leaked directory is not silently empty and unnoticed.
function recordingEditor(): RecordingEditor {
  let dirs: string[] = [];

  const editor: Editor = {
    name: "nano",
    collectMode: "buffer-diff",
    available: () => true,
    bufferSuffix: () => ".diff",
    headerHint: () => [],

    prepare(context: EditorContext): EditorLaunch {
      dirs = [...dirs, context.configDir];
      mkdirSync(context.configDir, { recursive: true });
      writeFileSync(join(context.configDir, "pair.nanorc"), "colour", "utf-8");

      return { argv: ["true"], env: {} };
    },
  };

  return { editor, configDirs: () => dirs };
}

function fakeMultiplexer(result: RunResult): Multiplexer {
  return {
    name: "none",
    available: () => true,
    run: () => result,
  };
}

function editorDirCount(): number {
  const root = join(stateDir(), "editor");

  return existsSync(root) ? readdirSync(root).length : 0;
}

test("the pane transport removes its per-review editor config directory after a review", async () => {
  const recording = recordingEditor();
  const multiplexer = fakeMultiplexer({ ok: true, detail: "" });
  const transport = createPaneTransport({ editor: recording.editor, multiplexer });

  expect(editorDirCount()).toBe(0);

  const outcome = await transport.review(requestFor(join(repoRoot, "file.txt")), DEFAULT_CONFIG);

  expect(outcome.reviewed).toBe(true);
  expect(recording.configDirs()).toHaveLength(1);
  expect(recording.configDirs().every((dir) => !existsSync(dir))).toBe(true);
  expect(editorDirCount()).toBe(0);
});

test("the pane transport removes its editor config directory when the multiplexer fails to launch", async () => {
  const recording = recordingEditor();
  const multiplexer = fakeMultiplexer({ ok: false, detail: "editor exited nonzero" });
  const transport = createPaneTransport({ editor: recording.editor, multiplexer });

  const outcome = await transport.review(requestFor(join(repoRoot, "file.txt")), DEFAULT_CONFIG);

  expect(outcome).toEqual({ reviewed: false, detail: "editor exited nonzero" });
  expect(recording.configDirs().every((dir) => !existsSync(dir))).toBe(true);
  expect(editorDirCount()).toBe(0);
});

test("the pane transport gives each review its own editor config directory", async () => {
  const recording = recordingEditor();
  const multiplexer = fakeMultiplexer({ ok: true, detail: "" });
  const transport = createPaneTransport({ editor: recording.editor, multiplexer });
  const request = requestFor(join(repoRoot, "file.txt"));

  await transport.review(request, DEFAULT_CONFIG);
  await transport.review(request, DEFAULT_CONFIG);

  const dirs = recording.configDirs();

  expect(dirs).toHaveLength(2);
  expect(dirs[0]).not.toBe(dirs[1]);
  expect(editorDirCount()).toBe(0);
});
