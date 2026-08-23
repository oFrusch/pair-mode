import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// True only when this module is the process entry point, not when a test imports it.
export function isEntryPoint(moduleUrl: string): boolean {
  const entryArg = process.argv[1];

  if (entryArg === undefined) {
    return false;
  }

  try {
    return realpathSync(entryArg) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
