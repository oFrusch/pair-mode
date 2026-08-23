import { spawnSync } from "node:child_process";
import type { PathResolver } from "./helpers.types";

// The default resolver shells out to `which` for a real PATH lookup.
export const defaultResolvesOnPath: PathResolver = (command) => {
  const result = spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
};
