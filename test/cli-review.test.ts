import { execFileSync } from "node:child_process";
import { realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, beforeEach } from "vitest";
import { formatNotes, parseReviewArgs, runReview } from "../src/cli/review";
import type { ReviewOptions } from "../src/cli/review";
import { DEFAULT_CONFIG } from "../src/core/config";
import type { Question } from "../src/core/collect";
import type { EditRequest, ReviewOutcome, ReviewTransport } from "../src/transports";
import { useIsolatedHome } from "./helpers/env";

const isolated = useIsolatedHome();
let repo: string;

function git(...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: repo,
    encoding: "utf-8",
  });
}

function commitAll(message: string): string {
  git("add", "-A");
  git("commit", "-q", "-m", message);

  return git("rev-parse", "HEAD").trim();
}

function write(path: string, content: string): void {
  writeFileSync(join(repo, path), content);
}

function optionsFor(overrides: Partial<ReviewOptions> = {}): ReviewOptions {
  return {
    directory: repo,
    base: "HEAD",
    head: null,
    approve: "approve",
    reject: "reject",
    ...overrides,
  };
}

// The fake answers each file from a table keyed by its path relative to the repo.
function fakeTransport(notes: Record<string, Question[]> = {}): {
  transport: ReviewTransport;
  seen: EditRequest[];
} {
  const seen: EditRequest[] = [];

  const transport: ReviewTransport = {
    name: "pane",

    review(request: EditRequest): Promise<ReviewOutcome> {
      seen.push(request);

      const relative = request.filePath.slice(repo.length + 1);

      return Promise.resolve({ reviewed: true, questions: notes[relative] ?? [] });
    },
  };

  return { transport, seen };
}

beforeEach(() => {
  repo = realpathSync(isolated.tempDir("pair-mode-review-"));

  git("init", "-q");
  write("kept.txt", "one\ntwo\n");
  write("gone.txt", "bye\n");
  commitAll("base");
});

test("parsing with no arguments reviews HEAD against the working tree of the cwd", () => {
  expect(parseReviewArgs([], "/tmp/work")).toEqual({
    ok: true,
    options: {
      directory: "/tmp/work",
      base: "HEAD",
      head: null,
      approve: "approve",
      reject: "reject",
    },
  });
});

test("parsing reads every value flag and the directory", () => {
  const parsed = parseReviewArgs(
    ["--base", "main", "--head", "feat", "--approve", "ok", "--reject", "no", "/tmp/repo"],
    "/tmp/work",
  );

  expect(parsed).toEqual({
    ok: true,
    options: { directory: "/tmp/repo", base: "main", head: "feat", approve: "ok", reject: "no" },
  });
});

test("parsing rejects an unknown flag, a flag with no value, and a second directory", () => {
  expect(parseReviewArgs(["--web"], "/tmp")).toEqual({
    ok: false,
    error: "unknown option for review: --web",
  });

  expect(parseReviewArgs(["--base"], "/tmp")).toEqual({ ok: false, error: "--base needs a value" });

  expect(parseReviewArgs(["--base", "--head"], "/tmp")).toEqual({
    ok: false,
    error: "--base needs a value",
  });

  expect(parseReviewArgs(["a", "b"], "/tmp")).toEqual({
    ok: false,
    error: "unexpected argument for review: b",
  });
});

test("an empty head value reviews the working tree, and an empty base is still an error", () => {
  const parsed = parseReviewArgs(["--head", ""], "/tmp/work");

  expect(parsed.ok && parsed.options.head).toBe(null);
  expect(parseReviewArgs(["--base", ""], "/tmp")).toEqual({
    ok: false,
    error: "--base needs a value",
  });
});

test("a clean review of the working tree approves and opens every changed file once", async () => {
  write("kept.txt", "one\nTWO\n");
  write("new.txt", "fresh\n");
  rmSync(join(repo, "gone.txt"));

  const { transport, seen } = fakeTransport();
  const result = await runReview(optionsFor(), { transport, config: DEFAULT_CONFIG });

  expect(result).toEqual({ ok: true, answer: { answer: "approve", notes: "" } });

  const byPath = Object.fromEntries(
    seen.map((request) => [request.filePath.slice(repo.length + 1), request]),
  );

  expect(seen).toHaveLength(3);
  expect(Object.keys(byPath).sort()).toEqual(["gone.txt", "kept.txt", "new.txt"]);
  expect(byPath["kept.txt"]).toMatchObject({ before: "one\ntwo\n", after: "one\nTWO\n" });
  expect(byPath["gone.txt"]).toMatchObject({ before: "bye\n", after: "" });
  expect(byPath["new.txt"]).toMatchObject({ before: "", after: "fresh\n" });
});

test("a note on any file rejects and carries the notes grouped by file", async () => {
  write("kept.txt", "one\nTWO\n");

  const { transport } = fakeTransport({
    "kept.txt": [{ line: 2, code: "TWO", text: "why upper case?" }],
  });

  const result = await runReview(optionsFor({ reject: "revise" }), {
    transport,
    config: DEFAULT_CONFIG,
  });

  expect(result).toEqual({
    ok: true,
    answer: { answer: "revise", notes: "kept.txt\n  line 2: TWO\n    why upper case?" },
  });
});

test("two refs review the committed diff and ignore the working tree", async () => {
  const base = git("rev-parse", "HEAD").trim();

  write("kept.txt", "one\ntwo\nthree\n");

  const head = commitAll("head");

  write("dirty.txt", "not committed\n");

  const { transport, seen } = fakeTransport();
  const result = await runReview(optionsFor({ base, head }), { transport, config: DEFAULT_CONFIG });

  expect(result.ok).toBe(true);
  expect(seen.map((request) => request.filePath)).toEqual([join(repo, "kept.txt")]);
  expect(seen[0]).toMatchObject({ before: "one\ntwo\n", after: "one\ntwo\nthree\n" });
});

test("a review with no changes approves without opening anything", async () => {
  const { transport, seen } = fakeTransport();
  const result = await runReview(optionsFor(), { transport, config: DEFAULT_CONFIG });

  expect(result).toEqual({ ok: true, answer: { answer: "approve", notes: "" } });
  expect(seen).toEqual([]);
});

test("a binary file is skipped rather than opened", async () => {
  write("blob.bin", "a\0b");

  const { transport, seen } = fakeTransport();
  const result = await runReview(optionsFor(), { transport, config: DEFAULT_CONFIG });

  expect(result.ok).toBe(true);
  expect(seen).toEqual([]);
});

test("a pane that cannot open fails the review so the gate stays blocked", async () => {
  write("kept.txt", "changed\n");

  const transport: ReviewTransport = {
    name: "pane",
    review: () => Promise.resolve({ reviewed: false, detail: "no controlling terminal" }),
  };

  const result = await runReview(optionsFor(), { transport, config: DEFAULT_CONFIG });

  expect(result).toEqual({
    ok: false,
    error: "could not open the review for kept.txt: no controlling terminal",
  });
});

test("a directory outside a repository fails the review", async () => {
  const outside = isolated.tempDir("pair-mode-not-a-repo-");
  const { transport } = fakeTransport();

  const result = await runReview(optionsFor({ directory: outside }), {
    transport,
    config: DEFAULT_CONFIG,
  });

  expect(result).toEqual({ ok: false, error: `not a git repository: ${outside}` });
});

test("an unknown ref fails the review instead of approving an empty diff", async () => {
  const { transport } = fakeTransport();

  const result = await runReview(optionsFor({ base: "no-such-ref" }), {
    transport,
    config: DEFAULT_CONFIG,
  });

  expect(result.ok).toBe(false);
});

test("the notes skip a file with no questions and leave out the line for an unanchored one", () => {
  const notes = formatNotes([
    { path: "a.ts", questions: [] },
    { path: "b.ts", questions: [{ line: null, code: "", text: "whole file?" }] },
  ]);

  expect(notes).toBe("b.ts\n    whole file?");
});

test("a symlink diffs by its target path, the way git stores it", async () => {
  write("target.txt", "secret\n");
  symlinkSync("target.txt", join(repo, "link"));
  commitAll("link");

  rmSync(join(repo, "link"));
  symlinkSync("kept.txt", join(repo, "link"));

  const { transport, seen } = fakeTransport();
  await runReview(optionsFor(), { transport, config: DEFAULT_CONFIG });

  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ before: "target.txt", after: "kept.txt" });
});

test("a range ref fails the review instead of showing every file as added", async () => {
  write("kept.txt", "changed\n");
  commitAll("next");

  const { transport, seen } = fakeTransport();
  const result = await runReview(optionsFor({ base: "HEAD~1...HEAD", head: "HEAD" }), {
    transport,
    config: DEFAULT_CONFIG,
  });

  expect(result).toEqual({ ok: false, error: "not a commit: HEAD~1...HEAD" });
  expect(seen).toEqual([]);
});
