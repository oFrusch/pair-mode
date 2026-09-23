import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../../core/config";
import { createPaneTransport } from "../../transports";
import type {
  ChangedFile,
  ChangedFiles,
  FileNotes,
  FileRead,
  GateAnswer,
  GitResult,
  GitRunner,
  ParsedReviewArgs,
  ReviewDeps,
  ReviewOptions,
  ReviewResult,
} from "./types";

const DEFAULT_BASE = "HEAD";
const DEFAULT_APPROVE = "approve";
const DEFAULT_REJECT = "reject";
const REVIEW_TOOL = "review";
const VALUE_FLAGS = ["--base", "--head", "--approve", "--reject"];
// git show on a large file overruns the 1 MiB spawnSync default.
const GIT_MAX_BUFFER = 256 * 1024 * 1024;

const defaultGit: GitRunner = (args, cwd): GitResult => {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8", maxBuffer: GIT_MAX_BUFFER });

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr || (result.error?.message ?? ""),
  };
};

export function parseReviewArgs(args: string[], cwd: string): ParsedReviewArgs {
  const values = new Map<string, string>();
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const entry = args[index] ?? "";

    if (!entry.startsWith("-") || entry === "-") {
      positionals.push(entry);

      continue;
    }

    if (!VALUE_FLAGS.includes(entry)) {
      return { ok: false, error: `unknown option for review: ${entry}` };
    }

    const value = args[index + 1];

    if (value === undefined || value.startsWith("-")) {
      return { ok: false, error: `${entry} needs a value` };
    }

    // An empty head is how a binding with an unfilled placeholder asks for the working tree.
    if (value === "" && entry !== "--head") {
      return { ok: false, error: `${entry} needs a value` };
    }

    values.set(entry, value);

    index += 1;
  }

  if (positionals.length > 1) {
    return { ok: false, error: `unexpected argument for review: ${positionals[1]}` };
  }

  return {
    ok: true,
    options: {
      directory: resolve(positionals[0] ?? cwd),
      base: values.get("--base") ?? DEFAULT_BASE,
      head: values.get("--head") || null,
      approve: values.get("--approve") ?? DEFAULT_APPROVE,
      reject: values.get("--reject") ?? DEFAULT_REJECT,
    },
  };
}

function splitNul(text: string): string[] {
  return text.split("\0").filter((entry) => entry !== "");
}

// A path the ref does not hold reads as empty, which is how an added or a deleted file diffs.
function showAt(git: GitRunner, root: string, ref: string, path: string): FileRead {
  const spec = `${ref}:${path}`;

  if (!git(["cat-file", "-e", spec], root).ok) {
    return { ok: true, text: "" };
  }

  const result = git(["show", spec], root);

  if (!result.ok) {
    return { ok: false, error: `git show ${spec} failed: ${result.stderr.trim()}` };
  }

  return { ok: true, text: result.stdout };
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// git stores a symlink as its target path, so the working side reads the link and not its target.
function readWorkingFile(root: string, path: string): FileRead {
  const full = join(root, path);

  try {
    const text = lstatSync(full).isSymbolicLink()
      ? readlinkSync(full)
      : readFileSync(full, "utf-8");

    return { ok: true, text };
  } catch (error) {
    if (isMissing(error)) {
      return { ok: true, text: "" };
    }

    const detail = error instanceof Error ? error.message : String(error);

    return { ok: false, error: `could not read ${path}: ${detail}` };
  }
}

// A range such as main...feat passes git diff but names no commit git show can read.
function isCommit(git: GitRunner, root: string, ref: string): boolean {
  return git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`], root).ok;
}

function isBinary(text: string): boolean {
  return text.includes("\0");
}

function changedFiles(git: GitRunner, options: ReviewOptions): ChangedFiles {
  const top = git(["rev-parse", "--show-toplevel"], options.directory);

  if (!top.ok) {
    return { ok: false, error: `not a git repository: ${options.directory}` };
  }

  const root = top.stdout.trim();
  const refs = options.head === null ? [options.base] : [options.base, options.head];
  const unknown = refs.find((ref) => !isCommit(git, root, ref));

  if (unknown !== undefined) {
    return { ok: false, error: `not a commit: ${unknown}` };
  }

  // A submodule has no text to annotate, so its pointer moves stay out of the review.
  const diff = git(
    ["diff", "--name-only", "-z", "--no-renames", "--ignore-submodules=all", ...refs, "--"],
    root,
  );

  if (!diff.ok) {
    return { ok: false, error: `git diff failed: ${diff.stderr.trim()}` };
  }

  const untracked =
    options.head === null
      ? git(["ls-files", "--others", "--exclude-standard", "-z"], root)
      : { ok: true, stdout: "", stderr: "" };

  if (!untracked.ok) {
    return { ok: false, error: `git ls-files failed: ${untracked.stderr.trim()}` };
  }

  const paths = [...new Set([...splitNul(diff.stdout), ...splitNul(untracked.stdout)])];

  const files: ChangedFile[] = [];

  for (const path of paths) {
    const before = showAt(git, root, options.base, path);
    const after =
      options.head === null ? readWorkingFile(root, path) : showAt(git, root, options.head, path);

    if (!before.ok) {
      return before;
    }

    if (!after.ok) {
      return after;
    }

    files.push({ path, before: before.text, after: after.text });
  }

  return { ok: true, root, files };
}

export function formatNotes(reviewed: FileNotes[]): string {
  return reviewed
    .filter((file) => file.questions.length > 0)
    .map((file) => {
      const body = file.questions.flatMap((question) => {
        const where = question.line === null ? [] : [`  line ${question.line}: ${question.code}`];

        return [...where, `    ${question.text}`];
      });

      return [file.path, ...body].join("\n");
    })
    .join("\n\n");
}

export async function runReview(
  options: ReviewOptions,
  deps: ReviewDeps = {},
): Promise<ReviewResult> {
  const git = deps.git ?? defaultGit;
  const config = deps.config ?? loadConfig().config;
  // The session transport needs a watcher, and a one-shot review has none, so it always opens a pane.
  const transport = deps.transport ?? createPaneTransport();
  const changed = changedFiles(git, options);

  if (!changed.ok) {
    return { ok: false, error: changed.error };
  }

  const reviewed: FileNotes[] = [];

  for (const file of changed.files) {
    if (file.before === file.after) {
      continue;
    }

    if (isBinary(file.before) || isBinary(file.after)) {
      process.stderr.write(`pair-mode review: skipped binary file ${file.path}\n`);

      continue;
    }

    const outcome = await transport.review(
      {
        tool: REVIEW_TOOL,
        filePath: join(changed.root, file.path),
        before: file.before,
        after: file.after,
      },
      config,
    );

    // A pane that never opened decided nothing, so the gate must stay blocked.
    if (!outcome.reviewed) {
      return { ok: false, error: `could not open the review for ${file.path}: ${outcome.detail}` };
    }

    reviewed.push({ path: file.path, questions: outcome.questions });
  }

  const notes = formatNotes(reviewed);
  const answer: GateAnswer = { answer: notes === "" ? options.approve : options.reject, notes };

  return { ok: true, answer };
}
