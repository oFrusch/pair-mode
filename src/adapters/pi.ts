import { readFileSync } from "node:fs";
import { isEnabled } from "../core/state";
import { simulate } from "../core/simulate";
import { runPair as defaultRunPair } from "../core/run";
import { loadConfig } from "../core/config";
import type {
  PiExtensionAPI,
  PiToolCallEvent,
  PiToolCallResult,
  RunPairFn,
} from "./pi.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFileOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function isEditItemInput(value: unknown): value is { oldText: string; newText: string } {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value["oldText"] === "string" && typeof value["newText"] === "string";
}

interface SimulateCall {
  tool: string;
  input: Record<string, unknown>;
  filePath: string;
}

// Translates pi's "write" and "edit" tool input into the tool name and shape simulate() understands.
function toSimulateCall(toolName: string, input: unknown): SimulateCall | null {
  if (!isRecord(input)) {
    return null;
  }

  const pathValue = input["path"];
  const filePath = typeof pathValue === "string" ? pathValue : "";

  if (filePath === "") {
    return null;
  }

  if (toolName === "write") {
    const contentValue = input["content"];
    const content = typeof contentValue === "string" ? contentValue : "";

    return { tool: "Write", input: { file_path: filePath, content }, filePath };
  }

  if (toolName === "edit") {
    const editsValue = input["edits"];

    if (!Array.isArray(editsValue)) {
      return null;
    }

    const edits: Record<string, unknown>[] = [];

    for (const item of editsValue) {
      if (!isEditItemInput(item)) {
        return null;
      }

      edits.push({ old_string: item.oldText, new_string: item.newText });
    }

    return { tool: "MultiEdit", input: { file_path: filePath, edits }, filePath };
  }

  return null;
}

// The pi extension's tool_call hook. Every failure resolves to { block: false } so a broken pair mode never blocks a write.
export async function handleToolCall(
  event: PiToolCallEvent,
  runPair: RunPairFn = defaultRunPair,
): Promise<PiToolCallResult> {
  try {
    const call = toSimulateCall(event.toolName, event.input);

    if (call === null) {
      return { block: false };
    }

    if (!isEnabled(call.filePath)) {
      return { block: false };
    }

    const request = simulate(call.tool, call.input, readFileOrEmpty);

    if (request === null) {
      return { block: false };
    }

    const config = loadConfig().config;
    const verdict = await runPair(request, config);

    if (verdict.decision === "allow") {
      return { block: false };
    }

    return { block: true, reason: verdict.reason };
  } catch {
    return { block: false };
  }
}

// Registered once when pi loads this file as an extension.
export default function activate(pi: PiExtensionAPI): void {
  pi.on("tool_call", (event) => handleToolCall(event));
}
