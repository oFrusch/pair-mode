import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PairConfig } from "../../core/config";
import type { RenderInput } from "../../core/render";
import { renderSplit, renderInline } from "../../core/render";
import { stateDir } from "../../core/state";
import { collect, parseNoteResult } from "../../core/collect";
import { resolve } from "../../editors";
import { detect } from "../../multiplexers";
import { readFileOrEmpty, resultFilePath, splitLines } from "../../helpers";
import type { EditRequest, ReviewOutcome, ReviewTransport } from "../transport.types";
import type { PaneDeps } from "./pane.types";

const NAME_BYTES = 6;

function splitCommand(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .filter((part) => part !== "");
}

function tempFile(prefix: string, suffix: string, content: string): string {
  const name = `${prefix}${randomBytes(NAME_BYTES).toString("hex")}${suffix}`;
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

function removeTreeQuietly(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only.
  }
}

// Two concurrent reviews with different themes would otherwise overwrite each other's editor config.
function reviewConfigDir(): string {
  return join(stateDir(), "editor", randomBytes(NAME_BYTES).toString("hex"));
}

// A multiplexer's server spawns the command, so process.env never reaches it. Baking KEY=VALUE into argv does.
function withEnvPrefix(argv: string[], env: Record<string, string>): string[] {
  const assignments = Object.entries(env).map(([key, value]) => `${key}=${value}`);

  if (assignments.length === 0) {
    return argv;
  }

  return ["env", ...assignments, ...argv];
}

async function reviewInPane(
  request: EditRequest,
  config: PairConfig,
  deps: PaneDeps,
): Promise<ReviewOutcome> {
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
  const usesResultFile = editor.collectMode === "result-file";

  const suffix = editor.bufferSuffix(request.filePath);
  const configDir = reviewConfigDir();

  // Inline has one logical buffer: left and right are the same content, so both panes point at the same file.
  let leftFile: string | null = null;
  let rightFile: string | null = null;
  const resultFile = resultFilePath();

  try {
    if (usesResultFile) {
      // A result-file editor does its own diffing and folding, so it gets the raw before/after text, not the pre-rendered marker view.
      leftFile = tempFile("pair-current-", suffix, request.before);
      rightFile = tempFile("pair-proposed-", suffix, request.after);
    } else if (isInline) {
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
      config,
    });

    const argv = withEnvPrefix(launch.argv, launch.env);
    const result = multiplexer.run(argv, config.pane);

    if (!result.ok) {
      return { reviewed: false, detail: result.detail };
    }

    const questions = usesResultFile
      ? parseNoteResult(readFileOrEmpty(resultFile))
      : collect(rendered.right, rendered.numbers, splitLines(readFileSync(rightFile, "utf-8")));

    return { reviewed: true, questions };
  } finally {
    if (leftFile !== null && leftFile !== rightFile) {
      removeQuietly(leftFile);
    }

    if (rightFile !== null) {
      removeQuietly(rightFile);
    }

    removeQuietly(resultFile);
    removeTreeQuietly(configDir);
  }
}

export function createPaneTransport(deps: PaneDeps = {}): ReviewTransport {
  return {
    name: "pane",

    review(request: EditRequest, config: PairConfig): Promise<ReviewOutcome> {
      return reviewInPane(request, config, deps);
    },
  };
}
