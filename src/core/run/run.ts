import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PairConfig } from "../config";
import type { EditRequest, RunVerdict } from "./types";
import type { RenderInput } from "../render";
import { renderSplit, renderInline } from "../render";
import { isEnabled, stateDir } from "../state";
import { collect, formatQuestions } from "../collect";
import { resolve } from "../../editors";
import { detect } from "../../multiplexers";
import type { RunResult } from "../../multiplexers/multiplexer.types";

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

function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Best-effort cleanup only.
  }
}

function applyEnv(env: Record<string, string>): () => void {
  const entries = Object.entries(env);
  const previous = new Map(entries.map(([key]) => [key, process.env[key]] as const));

  entries.forEach(([key, value]) => {
    process.env[key] = value;
  });

  return () => {
    previous.forEach((value, key) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  };
}

export async function runPair(request: EditRequest, config: PairConfig): Promise<RunVerdict> {
  if (request.before === request.after) {
    return { decision: "allow", reviewed: false };
  }

  if (!isEnabled(request.filePath)) {
    return { decision: "allow", reviewed: false };
  }

  const override = process.env["CC_PAIR_EDITOR"] || process.env["VISUAL"] || process.env["EDITOR"];
  const preference = override ? splitCommand(override) : config.editor;
  const editor = resolve(preference);
  const multiplexer = detect(config.multiplexer);

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
      sourcePath: request.filePath,
      theme: config.theme,
      configDir,
    });

    const restoreEnv = applyEnv(launch.env);
    let result: RunResult;

    try {
      result = multiplexer.run(launch.argv, config.pane);
    } finally {
      restoreEnv();
    }

    if (!result.ok) {
      return { decision: "allow", reviewed: false, reason: result.detail };
    }

    const saved = splitLines(readFileSync(rightFile, "utf-8"));
    const questions = collect(rendered.right, rendered.numbers, saved);

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
  }
}
