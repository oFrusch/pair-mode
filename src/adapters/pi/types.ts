import type { EditRequest, RunVerdict } from "../../core/run";
import type { PairConfig } from "../../core/config";

export type RunPairFn = (request: EditRequest, config: PairConfig) => Promise<RunVerdict>;

export interface PiToolCallEvent {
  toolName: string;
  input: unknown;
  sessionId?: string;
}

export interface PiToolCallResult {
  block: boolean;
  reason?: string;
}

export type PiNotifyLevel = "info" | "warning" | "error";

export interface PiCommandContext {
  cwd: string;
  ui: { notify(message: string, type?: PiNotifyLevel): void };
}

export interface PiCommandSpec {
  description: string;
  handler: (args: string, ctx: PiCommandContext) => Promise<void> | void;
}

export interface PiExtensionAPI {
  on(
    event: "tool_call",
    handler: (event: PiToolCallEvent) => PiToolCallResult | Promise<PiToolCallResult> | void,
  ): void;
  registerCommand(name: string, options: PiCommandSpec): void;
}
