import { spawnSync } from "node:child_process";
import type {
  Multiplexer,
  PaneSize,
  PathResolver,
  RunResult,
  Spawn,
  SpawnResult,
} from "./multiplexer.types";

// The default spawn shells out for real and captures stderr for a failure report.
const defaultSpawn: Spawn = (command, args): SpawnResult => {
  const result = spawnSync(command, args, { stdio: ["ignore", "ignore", "pipe"] });
  const stderr = result.stderr ? result.stderr.toString("utf-8") : "";
  return { status: result.status, stderr };
};

// The default resolver shells out to `which` for a real PATH lookup.
const defaultResolvesOnPath: PathResolver = (command) => {
  const result = spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
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
