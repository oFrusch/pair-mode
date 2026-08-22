import { readFileSync } from "node:fs";
import { isEnabled } from "../core/state";
import { simulate } from "../core/simulate";
import { runPair as defaultRunPair } from "../core/run";
import { loadConfig } from "../core/config";
import type {
  OpencodePlugin,
  OpencodeToolExecuteBeforeInput,
  OpencodeToolExecuteBeforeOutput,
  RunPairFn,
} from "./opencode.types";

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

interface SimulateCall {
  tool: string;
  input: Record<string, unknown>;
  filePath: string;
}

// Translates opencode's "write" and "edit" tool args into the tool name and shape simulate() understands.
function toSimulateCall(tool: string, args: Record<string, unknown>): SimulateCall | null {
  const filePathValue = args["filePath"];
  const filePath = typeof filePathValue === "string" ? filePathValue : "";

  if (filePath === "") {
    return null;
  }

  if (tool === "write") {
    const contentValue = args["content"];
    const content = typeof contentValue === "string" ? contentValue : "";

    return { tool: "Write", input: { file_path: filePath, content }, filePath };
  }

  if (tool === "edit") {
    const oldValue = args["oldString"];
    const newValue = args["newString"];
    const oldString = typeof oldValue === "string" ? oldValue : "";
    const newString = typeof newValue === "string" ? newValue : "";
    const replaceAllValue = args["replaceAll"];
    const replaceAll = typeof replaceAllValue === "boolean" ? replaceAllValue : false;

    return {
      tool: "Edit",
      input: { file_path: filePath, old_string: oldString, new_string: newString, replace_all: replaceAll },
      filePath,
    };
  }

  return null;
}

// Runs pair mode for one opencode tool call. Returns the deny reason, or null to allow.
async function evaluate(
  input: OpencodeToolExecuteBeforeInput,
  output: OpencodeToolExecuteBeforeOutput,
  runPair: RunPairFn,
): Promise<string | null> {
  if (!isRecord(output.args)) {
    return null;
  }

  const call = toSimulateCall(input.tool, output.args);

  if (call === null) {
    return null;
  }

  if (!isEnabled(call.filePath)) {
    return null;
  }

  const request = simulate(call.tool, call.input, readFileOrEmpty);

  if (request === null) {
    return null;
  }

  const config = loadConfig().config;
  const verdict = await runPair(request, config);

  return verdict.decision === "allow" ? null : verdict.reason;
}

// The opencode plugin's tool.execute.before hook. A deny verdict throws so opencode surfaces the reason as errorText.
export async function beforeToolExecute(
  input: OpencodeToolExecuteBeforeInput,
  output: OpencodeToolExecuteBeforeOutput,
  runPair: RunPairFn = defaultRunPair,
): Promise<void> {
  let reason: string | null = null;

  try {
    reason = await evaluate(input, output, runPair);
  } catch {
    return;
  }

  if (reason !== null) {
    throw new Error(reason);
  }
}

const plugin: OpencodePlugin = {
  "tool.execute.before": (input, output) => beforeToolExecute(input, output),
};

export default plugin;
