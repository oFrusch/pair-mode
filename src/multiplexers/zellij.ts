import { spawnSync } from "node:child_process";
import type {
  Multiplexer,
  PaneSize,
  RunResult,
  Spawn,
  SpawnResult,
} from "./multiplexer.types";
import type { PathResolver } from "../helpers/helpers.types";
import { defaultResolvesOnPath } from "../helpers/resolvesOnPath";

// The default spawn shells out for real and captures stderr for a failure report.
const defaultSpawn: Spawn = (command, args): SpawnResult => {
  const result = spawnSync(command, args, { stdio: ["ignore", "ignore", "pipe"] });
  const stderr = result.stderr ? result.stderr.toString("utf-8") : "";
  return { status: result.status, stderr };
};

export function createZellijMultiplexer(
  spawn: Spawn = defaultSpawn,
  resolvesOnPath: PathResolver = defaultResolvesOnPath,
): Multiplexer {
  return {
    name: "zellij",

    available(): boolean {
      return Boolean(process.env["ZELLIJ"]) && resolvesOnPath("zellij");
    },

    run(argv: string[], size: PaneSize): RunResult {
      const args = [
        "run",
        "--floating",
        "--close-on-exit",
        "--blocking",
        "--width",
        size.width,
        "--height",
        size.height,
        "--name",
        "pair",
        "--",
        ...argv,
      ];

      const result = spawn("zellij", args);

      return { ok: result.status === 0, detail: result.status === 0 ? "" : result.stderr };
    },
  };
}
