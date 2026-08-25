import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NAME_BYTES = 6;

// The TUI writes its questions here and the transport reads them back, so both sides derive the path the same way.
export function resultFilePath(): string {
  const name = `pair-result-${randomBytes(NAME_BYTES).toString("hex")}.json`;
  return join(tmpdir(), name);
}
