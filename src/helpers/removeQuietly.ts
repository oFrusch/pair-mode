import { unlinkSync } from "node:fs";

// Best-effort cleanup only. A missing or locked path must never fail the caller.
export function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // ignore
  }
}
