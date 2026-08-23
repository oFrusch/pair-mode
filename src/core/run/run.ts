import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PairConfig } from "../config";
import type { EditRequest, RunDeps, RunVerdict } from "./types";
import type { RenderInput } from "../render";
import { renderSplit, renderInline } from "../render";
import { isEnabled, stateDir } from "../state";
import { collect, formatQuestions, parseNoteResult } from "../collect";
import { resolve } from "../../editors";
import { detect } from "../../multiplexers";

// Same trailing-newline convention as render.ts: a lone trailing empty element is dropped.
function splitLines(text: string): string[] {
  const lines = text.split("\n");
  const last = lines.at(-1);

  if (last === "") {
    lines.pop();
  }

  return lines;
}

function splitCommand(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .filter((part) => part !== "");
}

function tempFile(prefix: string, suffix: string, content: string): string {
  const name = `${prefix}${randomBytes(6).toString("hex")}${suffix}`;
  const path = join(tmpdir(), name);
  writeFileSync(path, content, "utf-8");
  return path;
}

function readResultFile(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function resultFilePath(): string {
  const name = `pair-result-${randomBytes(6).toString("hex")}.json`;
  return join(tmpdir(), name);
}

function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Best-effort cleanup only.
  }
}

// A multiplexer's server spawns the command, so process.env never reaches it. Baking KEY=VALUE into argv does.
function withEnvPrefix(argv: string[], env: Record<string, string>): string[] {
  const assignments = Object.entries(env).map(([key, value]) => `${key}=${value}`);

  if (assignments.length === 0) {
    return argv;
  }

  return ["env", ...assignments, ...argv];
}

export async function runPair(
  request: EditRequest,
  config: PairConfig,
  deps: RunDeps = {},
): Promise<RunVerdict> {
  if (request.before === request.after) {
    return { decision: "allow", reviewed: false };
  }

  if (!isEnabled(request.filePath)) {
    return { decision: "allow", reviewed: false };
  }

  const override = process.env["CC_PAIR_EDITOR"] || process.env["VISUAL"] || process.env["EDITOR"];
  const preference = override ? splitCommand(override) : config.editor;
  const editor = deps.editor ?? resolve(preference);
  const multiplexer = deps.multiplexer ?? detect(config.multiplexer);

  const renderInput: RenderInput = {
    before: request.before,
    after: request.after,
    tool: request.tool,
    path: request.filePath,
    context: config.context,
    minFold: config.minFold,
    headerHint: editor.headerHint(),
  };

  const isInline = config.layout === "inline";
  const rendered = isInline ? renderInline(renderInput) : renderSplit(renderInput);

  const suffix = editor.bufferSuffix(request.filePath);
  const configDir = join(stateDir(), "editor");

  // Inline has one logical buffer: left and right are the same content, so both panes point at the same file.
  let leftFile: string | null = null;
  let rightFile: string | null = null;
  const resultFile = resultFilePath();

  try {
    if (isInline) {
      leftFile = tempFile("pair-inline-", suffix, rendered.left.join("\n") + "\n");
      rightFile = leftFile;
    } else {
      leftFile = tempFile("pair-current-", suffix, rendered.left.join("\n") + "\n");
      rightFile = tempFile("pair-proposed-", suffix, rendered.right.join("\n") + "\n");
    }

    const launch = editor.prepare({
      leftFile,
      rightFile,
      resultFile,
      sourcePath: request.filePath,
      theme: config.theme,
      configDir,
    });

    const argv = withEnvPrefix(launch.argv, launch.env);
    const result = multiplexer.run(argv, config.pane);

    if (!result.ok) {
      return { decision: "allow", reviewed: false, reason: result.detail };
    }

    const questions =
      editor.collectMode === "result-file"
        ? parseNoteResult(readResultFile(resultFile))
        : collect(rendered.right, rendered.numbers, splitLines(readFileSync(rightFile, "utf-8")));

    if (questions.length === 0) {
      return { decision: "allow", reviewed: true };
    }

    return { decision: "deny", reason: formatQuestions(questions, request.filePath) };
  } finally {
    if (leftFile !== null && leftFile !== rightFile) {
      removeQuietly(leftFile);
    }

    if (rightFile !== null) {
      removeQuietly(rightFile);
    }

    removeQuietly(resultFile);
  }
}
