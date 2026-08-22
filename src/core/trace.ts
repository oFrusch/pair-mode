import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PairConfig } from "./config.types";
import { stateDir } from "./state";

export function trace(message: string, config: PairConfig): void {
  if (!config.trace) {
    return;
  }

  try {
    const dir = stateDir();
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "trace.log"), message + "\n", "utf-8");
  } catch {
    // A trace write must never fail the hook.
  }
}
