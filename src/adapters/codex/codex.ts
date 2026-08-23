import { isEnabled } from "../../core/state";
import { simulate } from "../../core/simulate";
import { runPair } from "../../core/run";
import { loadConfig, DEFAULT_CONFIG } from "../../core/config";
import { trace } from "../../core/trace";
import type { PairConfig } from "../../core/config";
import type { EditItem } from "../../core/simulate";
import type { ParsedPatch, HunkLine } from "./types";
import { isEntryPoint } from "../entry-point";
import { isRecord, readFileOrEmpty, readPayload } from "../../helpers";

const BEGIN_PATCH = "*** Begin Patch";

const hasPatchMarker = (value: unknown): value is string =>
  typeof value === "string" && value.includes(BEGIN_PATCH);

// Accepts the patch body as a plain command string or as one element of a command array.
export function extractPatchText(toolInput: Record<string, unknown>): string | null {
  const command = toolInput["command"];

  if (hasPatchMarker(command)) return command;

  if (!Array.isArray(command)) return null;

  return command.find(hasPatchMarker) ?? null;
}

// Extracts the single file section between the Begin/End markers, or null when unsupported.
function extractSection(patchText: string): { header: string; body: string[] } | null {
  const lines = patchText.split("\n");
  const beginIndex = lines.findIndex((line) => line.trim() === BEGIN_PATCH);
  const endIndex = lines.findIndex((line) => line.trim() === "*** End Patch");

  if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) {
    return null;
  }

  const inner = lines.slice(beginIndex + 1, endIndex);
  const headerIndex = inner.findIndex((line) => line.startsWith("*** "));

  if (headerIndex === -1) {
    return null;
  }

  const header = inner[headerIndex];
  const rest = inner.slice(headerIndex + 1);
  const nextHeaderIndex = rest.findIndex((line) => line.startsWith("*** "));

  if (header === undefined) {
    return null;
  }

  // A second header means either a rename ("Move to") or a second file section, both unsupported.
  if (nextHeaderIndex !== -1) {
    return null;
  }

  return { header, body: rest };
}

function pathFromHeader(header: string, marker: string): string | null {
  if (!header.startsWith(marker)) {
    return null;
  }

  const path = header.slice(marker.length).trim();
  return path === "" ? null : path;
}

// A pure addition: every line must be prefixed with "+". A trimmed blank line is a blank content line, not a line to drop.
function parseAddFile(body: string[]): string | null {
  if (!body.every((line) => line === "" || line.startsWith("+"))) {
    return null;
  }

  const contentLines = body.map((line) => (line === "" ? "" : line.slice(1)));

  return contentLines.join("\n") + "\n";
}

// A patch generator that trims trailing whitespace turns a blank " " context line into "".
function classifyHunkLine(line: string): HunkLine | null {
  if (line.startsWith(" ")) {
    return { old: line.slice(1), new: line.slice(1) };
  }

  if (line.startsWith("-")) {
    return { old: line.slice(1), new: null };
  }

  if (line.startsWith("+")) {
    return { old: null, new: line.slice(1) };
  }

  if (line === "") {
    return { old: "", new: "" };
  }

  return null;
}

// One hunk: context and removed lines form old_string, context and added lines form new_string.
function hunkToEdit(hunkLines: string[]): EditItem | null {
  const classified = hunkLines.map(classifyHunkLine);

  if (!classified.every((entry): entry is HunkLine => entry !== null)) {
    return null;
  }

  const oldLines = classified.flatMap((entry) => (entry.old !== null ? [entry.old] : []));
  const newLines = classified.flatMap((entry) => (entry.new !== null ? [entry.new] : []));

  // A hunk with no context or removed line has no anchor, so its position is a guess.
  if (oldLines.length === 0) {
    return null;
  }

  return { old_string: oldLines.join("\n"), new_string: newLines.join("\n") };
}

function parseUpdateFile(body: string[]): EditItem[] | null {
  const hunks: string[][] = [];
  let current: string[] | null = null;

  for (const line of body) {
    if (line.startsWith("@@")) {
      current = [];
      hunks.push(current);
      continue;
    }

    if (current === null) {
      current = [];
      hunks.push(current);
    }

    current.push(line);
  }

  if (hunks.length === 0) {
    return null;
  }

  const edits = hunks.map(hunkToEdit);

  if (!edits.every((edit): edit is EditItem => edit !== null)) {
    return null;
  }

  return edits;
}

// Translates one apply_patch body into the shape simulate() already understands.
export function parsePatch(patchText: string): ParsedPatch | null {
  const section = extractSection(patchText);

  if (section === null) {
    return null;
  }

  const addPath = pathFromHeader(section.header, "*** Add File:");

  if (addPath !== null) {
    const content = parseAddFile(section.body);

    if (content === null) {
      return null;
    }

    return { filePath: addPath, tool: "Write", content };
  }

  const deletePath = pathFromHeader(section.header, "*** Delete File:");

  if (deletePath !== null) {
    return { filePath: deletePath, tool: "Write", content: "" };
  }

  const updatePath = pathFromHeader(section.header, "*** Update File:");

  if (updatePath !== null) {
    const edits = parseUpdateFile(section.body);

    if (edits === null) {
      return null;
    }

    return { filePath: updatePath, tool: "MultiEdit", edits };
  }

  return null;
}

function toolNameFor(payload: Record<string, unknown>): string {
  const value = payload["tool_name"];
  return typeof value === "string" ? value : "";
}

async function main(config: PairConfig): Promise<number> {
  const payload = readPayload();

  if (!isRecord(payload)) {
    return 0;
  }

  const tool = toolNameFor(payload);
  const toolInput = payload["tool_input"];

  if (!isRecord(toolInput)) {
    return 0;
  }

  let simTool = tool;
  let simInput: Record<string, unknown> = toolInput;

  if (tool === "apply_patch") {
    const patchText = extractPatchText(toolInput);

    if (patchText === null) {
      trace("exit: apply_patch payload had no patch text", config);
      return 0;
    }

    const parsed = parsePatch(patchText);

    if (parsed === null) {
      trace("exit: apply_patch body defeated the parser", config);
      return 0;
    }

    simTool = parsed.tool;
    simInput =
      parsed.tool === "Write"
        ? { file_path: parsed.filePath, content: parsed.content ?? "" }
        : { file_path: parsed.filePath, edits: parsed.edits ?? [] };
  }

  const filePathValue = simInput["file_path"];
  const filePath = typeof filePathValue === "string" ? filePathValue : "";

  if (filePath === "") {
    return 0;
  }

  if (!isEnabled(filePath)) {
    return 0;
  }

  const request = simulate(simTool, simInput, readFileOrEmpty);

  if (request === null) {
    trace("exit: could not simulate", config);
    return 0;
  }

  const verdict = await runPair(request, config);

  if (verdict.decision === "allow") {
    return 0;
  }

  const denyJson = JSON.stringify({
    hookSpecificOutput: {
      permissionDecision: "deny",
      permissionDecisionReason: verdict.reason,
    },
  });

  try {
    process.stdout.write(denyJson + "\n");
    return 0;
  } catch {
    process.stderr.write(verdict.reason + "\n");
    return 2;
  }
}

// A hook that fails must never block the user's work, so every error path exits 0.
async function run(): Promise<number> {
  let config: PairConfig = DEFAULT_CONFIG;

  try {
    config = loadConfig().config;
    return await main(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    trace(`exit: error ${message}`, config);
    return 0;
  }
}

// Only runs the hook when this file is the process entry point, not when a test imports parsePatch.
if (isEntryPoint(import.meta.url)) {
  const code = await run();
  process.exit(code);
}
