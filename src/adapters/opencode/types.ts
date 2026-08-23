import type { EditRequest, RunVerdict } from "../../core/run";
import type { PairConfig } from "../../core/config";

export type RunPairFn = (request: EditRequest, config: PairConfig) => Promise<RunVerdict>;

export interface OpencodeToolExecuteBeforeInput {
  tool: string;
  sessionID: string;
  callID: string;
}

export interface OpencodeToolExecuteBeforeOutput {
  args: unknown;
}

export interface OpencodePlugin {
  "tool.execute.before"?: (
    input: OpencodeToolExecuteBeforeInput,
    output: OpencodeToolExecuteBeforeOutput,
  ) => Promise<void>;
}
