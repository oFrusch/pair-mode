import { isEnabled, keyFor } from "../../core/state";
import { simulate } from "../../core/simulate";
import { runPair } from "../../core/run";
import { loadConfig, DEFAULT_CONFIG } from "../../core/config";
import { trace } from "../../core/trace";
import { applyHunks } from "./apply";
import type { PairConfig } from "../../core/config";
import type { EditRequest } from "../../core/run";
import type { SessionKey } from "../../core/state";
import type { ParsedPatch, HunkLine } from "./types";
import { isEntryPoint } from "../entry-point";
import { isRecord, readFileOrEmpty, readPayload } from "../../helpers";

const BEGIN_PATCH = "*** Begin Patch";
const END_PATCH = "*** End Patch";
const END_OF_FILE = "*** End of File";
const MOVE_TO_PREFIX = "*** Move to:";

// A rename or an End of File sentinel is not a new file section, just a line inside the current one.
function isSectionHeader(line: string): boolean {
  return line.startsWith("*** ") && !line.startsWith(MOVE_TO_PREFIX) && line.trim() !== END_OF_FILE;
}

// The EOF sentinel closes a section's body, so drop it before it reads as file content.
function stripEndOfFile(body: string[]): string[] {
  const lastIndex = body.findLastIndex((line) => line.trim() !== "");

  if (lastIndex === -1 || body[lastIndex]?.trim() !== END_OF_FILE) {
    return body;
  }

  return [...body.slice(0, lastIndex), ...body.slice(lastIndex + 1)];
}

const hasPatchMarker = (value: unknown): value is string =>
  typeof value === "string" && value.includes(BEGIN_PATCH);

// Accepts the patch body as a plain command string or as one element of a command array.
export function extractPatchText(toolInput: Record<string, unknown>): string | null {
  const command = toolInput["command"];

  if (hasPatchMarker(command)) return command;

  if (!Array.isArray(command)) return null;

  return command.find(hasPatchMarker) ?? null;
}

// Splits the patch body into every file section it contains, in order.
function parseSections(patchText: string): { header: string; body: string[] }[] | null {
  const lines = patchText.split("\n");
  const beginIndex = lines.findIndex((line) => line.trim() === BEGIN_PATCH);
  const endIndex = lines.findIndex((line) => line.trim() === END_PATCH);

  if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) {
    return null;
  }

  const inner = lines.slice(beginIndex + 1, endIndex);
  const headerIndices = inner.reduce<number[]>(
    (acc, line, index) => (isSectionHeader(line) ? [...acc, index] : acc),
    [],
  );

  if (headerIndices.length === 0) {
    return null;
  }

  return headerIndices.map((headerIndex, order) => {
    const header = inner[headerIndex] ?? "";
    const end = headerIndices[order + 1] ?? inner.length;
    const rawBody = inner.slice(headerIndex + 1, end);
    const bodyNoEof = stripEndOfFile(rawBody);
    // A Move to line rides along with its Update section; the rename target is never reviewed.
    const body = bodyNoEof.filter((line) => !line.startsWith(MOVE_TO_PREFIX));

    return { header, body };
  });
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

// The text after "@@ " locates the hunk in the file; a bare "@@" carries no context.
function contextFor(line: string): string | null {
  if (line === "@@") {
    return null;
  }

  return line.startsWith("@@ ") ? line.slice(3) : line.slice(2);
}

interface HunkGroup {
  context: string | null;
  raw: string[];
}

function parseUpdateFile(body: string[]): { context: string | null; lines: HunkLine[] }[] | null {
  const groups: HunkGroup[] = [];
  let current: HunkGroup | null = null;

  for (const line of body) {
    if (line.startsWith("@@")) {
      current = { context: contextFor(line), raw: [] };
      groups.push(current);
      continue;
    }

    if (current === null) {
      current = { context: null, raw: [] };
      groups.push(current);
    }

    current.raw.push(line);
  }

  if (groups.length === 0) {
    return null;
  }

  const hunks = groups.map((group) => {
    const classified = group.raw.map(classifyHunkLine);

    if (!classified.every((entry): entry is HunkLine => entry !== null)) {
      return null;
    }

    return { context: group.context, lines: classified };
  });

  if (
    !hunks.every((hunk): hunk is { context: string | null; lines: HunkLine[] } => hunk !== null)
  ) {
    return null;
  }

  return hunks;
}

function parseSection(section: { header: string; body: string[] }): ParsedPatch | null {
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
    const hunks = parseUpdateFile(section.body);

    if (hunks === null) {
      return null;
    }

    return { filePath: updatePath, tool: "MultiEdit", hunks };
  }

  return null;
}

// Translates one apply_patch body into every file section simulate() or applyHunks() can review.
export function parsePatch(patchText: string): ParsedPatch[] | null {
  const sections = parseSections(patchText);

  if (sections === null) {
    return null;
  }

  const parsed = sections.map(parseSection);

  if (!parsed.every((entry): entry is ParsedPatch => entry !== null)) {
    return null;
  }

  return parsed;
}

function toolNameFor(payload: Record<string, unknown>): string {
  const value = payload["tool_name"];
  return typeof value === "string" ? value : "";
}

function emitDeny(reason: string): number {
  // Codex requires hookEventName and rejects the whole object without it, which applies the edit.
  const denyJson = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });

  try {
    process.stdout.write(denyJson + "\n");
    return 0;
  } catch {
    process.stderr.write(reason + "\n");
    return 2;
  }
}

// Builds the request for one patch section, applying hunks directly since simulate() has no hunk-cursor model.
function buildRequest(
  section: ParsedPatch,
  sessionId: string | undefined,
  config: PairConfig,
): EditRequest | null {
  if (section.tool === "Write") {
    const input = { file_path: section.filePath, content: section.content ?? "" };
    return simulate("Write", input, readFileOrEmpty, sessionId);
  }

  const before = readFileOrEmpty(section.filePath);
  const after = applyHunks(before, section.hunks ?? []);

  if (after === null) {
    trace("exit: apply_patch hunk defeated the applier", config);
    return null;
  }

  return { tool: "MultiEdit", filePath: section.filePath, before, after, sessionId };
}

// Reviews every section in order. The first deny ends the loop and denies the whole patch.
async function reviewPatch(
  toolInput: Record<string, unknown>,
  sessionId: string | undefined,
  key: SessionKey | undefined,
  config: PairConfig,
): Promise<number> {
  const patchText = extractPatchText(toolInput);

  if (patchText === null) {
    trace("exit: apply_patch payload had no patch text", config);
    return 0;
  }

  const sections = parsePatch(patchText);

  if (sections === null) {
    trace("exit: apply_patch body defeated the parser", config);
    return 0;
  }

  for (const section of sections) {
    if (!isEnabled(section.filePath, key)) {
      continue;
    }

    const request = buildRequest(section, sessionId, config);

    if (request === null) {
      continue;
    }

    const verdict = await runPair(request, config);

    if (verdict.decision === "deny") {
      return emitDeny(verdict.reason);
    }
  }

  return 0;
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

  const rawSessionId = payload["session_id"];
  const sessionId = typeof rawSessionId === "string" ? rawSessionId : undefined;
  const key = keyFor(sessionId);

  if (tool === "apply_patch") {
    return reviewPatch(toolInput, sessionId, key, config);
  }

  const filePathValue = toolInput["file_path"];
  const filePath = typeof filePathValue === "string" ? filePathValue : "";

  if (filePath === "" || !isEnabled(filePath, key)) {
    return 0;
  }

  const request = simulate(tool, toolInput, readFileOrEmpty, sessionId);

  if (request === null) {
    trace("exit: could not simulate", config);
    return 0;
  }

  const verdict = await runPair(request, config);

  if (verdict.decision === "allow") {
    return 0;
  }

  return emitDeny(verdict.reason);
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
