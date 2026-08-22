import { readFileSync } from "node:fs";
import { isEnabled } from "../core/state";
import { simulate } from "../core/simulate";
import { runPair } from "../core/run";
import { loadConfig, DEFAULT_CONFIG } from "../core/config";
import { trace } from "../core/trace";
import type { PairConfig } from "../core/config.types";
import type { EditItem } from "../core/simulate.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPayload(): unknown {
  const text = readFileSync(0, "utf-8");
  return JSON.parse(text);
}

function readFileOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

// Accepts the patch body as a plain command string or as one element of a command array.
function extractPatchText(toolInput: Record<string, unknown>): string | null {
  const command = toolInput["command"];

  if (typeof command === "string" && command.includes("*** Begin Patch")) {
    return command;
  }

  if (Array.isArray(command)) {
    for (const part of command) {
      if (typeof part === "string" && part.includes("*** Begin Patch")) {
        return part;
      }
    }
  }

  return null;
}

interface ParsedPatch {
  filePath: string;
  tool: "Write" | "MultiEdit";
  content?: string;
  edits?: EditItem[];
}

// Extracts the single file section between the Begin/End markers, or null when unsupported.
function extractSection(patchText: string): { header: string; body: string[] } | null {
  const lines = patchText.split("\n");
  const beginIndex = lines.findIndex((line) => line.trim() === "*** Begin Patch");
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

// A pure addition: every line must be prefixed with "+".
function parseAddFile(body: string[]): string | null {
  const contentLines: string[] = [];

  for (const line of body) {
    if (line === "") {
      continue;
    }

    if (!line.startsWith("+")) {
      return null;
    }

    contentLines.push(line.slice(1));
  }

  return contentLines.join("\n") + "\n";
}

// One hunk: context and removed lines form old_string, context and added lines form new_string.
function hunkToEdit(hunkLines: string[]): EditItem | null {
  const oldLines: string[] = [];
  const newLines: string[] = [];

  for (const line of hunkLines) {
    if (line.startsWith(" ")) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
      continue;
    }

    if (line.startsWith("-")) {
      oldLines.push(line.slice(1));
      continue;
    }

    if (line.startsWith("+")) {
      newLines.push(line.slice(1));
      continue;
    }

    if (line === "") {
      continue;
    }

    return null;
  }

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

  const edits: EditItem[] = [];

  for (const hunk of hunks) {
    const edit = hunkToEdit(hunk);

    if (edit === null) {
      return null;
    }

    edits.push(edit);
  }

  return edits;
}

// Translates one apply_patch body into the shape simulate() already understands.
function parsePatch(patchText: string): ParsedPatch | null {
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
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { permissionDecision: "allow" } }) + "\n");
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

const code = await run();
process.exit(code);
