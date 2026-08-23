import { isEnabled } from "../core/state";
import { simulate } from "../core/simulate";
import { runPair } from "../core/run";
import { loadConfig, DEFAULT_CONFIG } from "../core/config";
import { trace } from "../core/trace";
import type { PairConfig } from "../core/config.types";
import { isEntryPoint } from "./entry-point";
import { isRecord, readFileOrEmpty, readPayload } from "../helpers";

async function main(config: PairConfig): Promise<number> {
  const payload = readPayload();

  if (!isRecord(payload)) {
    return 0;
  }

  const toolName = payload["tool_name"];
  const tool = typeof toolName === "string" ? toolName : "";
  const toolInput = payload["tool_input"];

  if (!isRecord(toolInput)) {
    return 0;
  }

  const filePathValue = toolInput["file_path"];
  const filePath = typeof filePathValue === "string" ? filePathValue : "";

  if (filePath === "") {
    return 0;
  }

  if (!isEnabled(filePath)) {
    return 0;
  }

  const request = simulate(tool, toolInput, readFileOrEmpty);

  if (request === null) {
    trace("exit: could not simulate", config);
    return 0;
  }

  const verdict = await runPair(request, config);

  if (verdict.decision === "allow") {
    return 0;
  }

  process.stderr.write(verdict.reason + "\n");
  return 2;
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

// Only runs the hook when this file is the process entry point, not when a test imports this module.
if (isEntryPoint(import.meta.url)) {
  const code = await run();
  process.exit(code);
}
