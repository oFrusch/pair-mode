import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import type { SessionKind, SessionRecord, SessionRecordOptions } from "./state.types";

// A hung git call would stall a watcher before it ever serves a review, so the branch lookup is bounded.
const GIT_TIMEOUT_MS = 2000;

function currentBranch(directory: string): string | null {
  const result = spawnSync("git", ["-C", directory, "rev-parse", "--abbrev-ref", "HEAD"], {
    encoding: "utf-8",
    timeout: GIT_TIMEOUT_MS,
  });

  if (result.status !== 0) {
    return null;
  }

  const branch = result.stdout.trim();
  return branch === "" ? null : branch;
}

// A person reads the label, not the id, so it names the checkout and the branch.
function sessionLabel(directory: string, branch: string | null): string {
  const name = basename(directory);
  return branch === null ? name : `${name}@${branch}`;
}

// Both the terminal watcher and the web watcher write this sidecar, so they build it the same way.
export function buildSessionRecord(
  options: SessionRecordOptions,
  socketPath: string,
): SessionRecord {
  const branch = currentBranch(options.directory);
  const kind: SessionKind = options.sessionKey === undefined ? "directory" : "session";

  return {
    id: options.sessionKey ?? basename(socketPath, ".sock"),
    kind,
    label: sessionLabel(options.directory, branch),
    directory: options.directory,
    branch,
    agentSessionId: options.agentSessionId ?? null,
    agentKind: options.agentKind ?? null,
    createdAt: new Date().toISOString(),
    pid: process.pid,
  };
}
