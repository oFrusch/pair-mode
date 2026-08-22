import { readFileSync } from "node:fs";
import { isEnabled } from "../core/state";
import { simulate } from "../core/simulate";
import { runPair } from "../core/run";
import { loadConfig } from "../core/config";
import { trace } from "../core/trace";
import type { PairConfig } from "../core/config.types";

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
  const config = loadConfig().config;

  try {
    return await main(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    trace(`exit: error ${message}`, config);
    return 0;
  }
}

const code = await run();
process.exit(code);
