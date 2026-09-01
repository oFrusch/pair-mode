import { isEnabled, sessionKey } from "../../core/state";
import { simulate } from "../../core/simulate";
import { pairOff, pairOn, pairStatus } from "../../cli/toggle";
import { runPair as defaultRunPair } from "../../core/run";
import { loadConfig } from "../../core/config";
import type {
  PiCommandContext,
  PiExtensionAPI,
  PiToolCallEvent,
  PiToolCallResult,
  RunPairFn,
} from "./types";
import type { SimulateCall } from "../adapter.types";
import { isRecord, readFileOrEmpty } from "../../helpers";

function isEditItemInput(value: unknown): value is { oldText: string; newText: string } {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value["oldText"] === "string" && typeof value["newText"] === "string";
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

  switch (toolName) {
    case "write": {
      const contentValue = input["content"];
      const content = typeof contentValue === "string" ? contentValue : "";

      return { tool: "Write", input: { file_path: filePath, content }, filePath };
    }
    case "edit": {
      const editsValue = input["edits"];

      if (!Array.isArray(editsValue)) {
        return null;
      }

      if (!editsValue.every(isEditItemInput)) return null;

      const edits = editsValue.map(({ oldText, newText }) => ({
        old_string: oldText,
        new_string: newText,
      }));

      return { tool: "MultiEdit", input: { file_path: filePath, edits }, filePath };
    }
    default:
      return null;
  }
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

    // pi names the session on the event, so pair mode keys off it exactly as the hook adapters do.
    const sessionId = event.sessionId === "" ? undefined : event.sessionId;
    const key = sessionId === undefined ? undefined : sessionKey(sessionId);

    if (!isEnabled(call.filePath, key)) {
      return { block: false };
    }

    const request = simulate(call.tool, call.input, readFileOrEmpty, sessionId);

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

// pi has no per-directory state of its own, so /pair drives the same flag file the CLI writes.
export function runPairCommand(args: string, directory: string): string {
  const action = args.trim().toLowerCase();

  if (action === "on") {
    return pairOn(directory);
  }

  if (action === "off") {
    return pairOff(directory);
  }

  if (action === "" || action === "status") {
    return pairStatus(directory);
  }

  return `pair: unknown action "${action}". Use on, off, or status.`;
}

// Registered once when pi loads this file as an extension.
export default function activate(pi: PiExtensionAPI): void {
  pi.on("tool_call", (event) => handleToolCall(event));

  pi.registerCommand("pair", {
    description: "Turn pair mode on or off for this directory",
    handler: (args: string, ctx: PiCommandContext) => {
      ctx.ui.notify(runPairCommand(args, ctx.cwd), "info");
    },
  });
}
