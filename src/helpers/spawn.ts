import { spawnSync } from "node:child_process";
import type { Spawn, SpawnResult } from "./types";

// The default spawn shells out for real and captures stderr for a failure report.
export const defaultSpawn: Spawn = (command, args): SpawnResult => {
  const result = spawnSync(command, args, { stdio: ["ignore", "ignore", "pipe"] });

  // A missing binary yields no stderr at all, so the error message is the only real reason.
  const stderr = result.stderr ? result.stderr.toString("utf-8") : (result.error?.message ?? "");

  return { status: result.status, stderr };
};
