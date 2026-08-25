import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, beforeEach, afterEach } from "vitest";
import { splitLines } from "../src/helpers/splitLines";
import { resultFilePath } from "../src/helpers/resultFilePath";
import { resolveTransport } from "../src/transports";
import type { EditRequest, ReviewTransport, ReviewOutcome } from "../src/transports";
import { runPair } from "../src/core/run";
import { DEFAULT_CONFIG } from "../src/core/config";
import type { PairConfig } from "../src/core/config";
import { enable } from "../src/core/state";

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
  const otherRepo = realpathSync(mkdtempSync(join(tmpdir(), "pair-mode-other-repo-")));
  const filePath = join(otherRepo, "file.txt");

  await runPair(requestFor(filePath), config, { transport });

  expect(reviewCount()).toBe(0);
});
