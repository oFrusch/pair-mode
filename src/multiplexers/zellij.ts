import type { Multiplexer, PaneSize, RunResult, Spawn } from "./multiplexer.types";
import type { PathResolver } from "../helpers/types";
import { defaultResolvesOnPath } from "../helpers/resolvesOnPath";
import { defaultSpawn } from "../helpers/spawn";

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
