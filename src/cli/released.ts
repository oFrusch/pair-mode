import type { CliName } from "./detect/types";

// opencode and pi ship in 1.0.0, so setup and doctor leave their adapters alone until then.
export const RELEASED_CLIS: CliName[] = ["claude-code", "codex"];

export function isReleased(cli: CliName): boolean {
  return RELEASED_CLIS.includes(cli);
}
