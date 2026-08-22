import { openSync, closeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { Multiplexer, PaneSize, RunResult } from "./multiplexer.types";

export function createTtyMultiplexer(): Multiplexer {
  return {
    name: "none",

    available(): boolean {
      try {
        closeSync(openSync("/dev/tty", "r+"));
        return true;
      } catch {
        return false;
      }
    },

    run(argv: string[], _size: PaneSize): RunResult {
      let fd: number;

      try {
        fd = openSync("/dev/tty", "r+");
      } catch {
        return { ok: false, detail: "no controlling terminal (ENXIO)" };
      }

      const [command, ...args] = argv;

      if (!command) {
        closeSync(fd);
        return { ok: false, detail: "no command given" };
      }

      const result = spawnSync(command, args, { stdio: [fd, fd, fd] });
      closeSync(fd);

      return { ok: result.status === 0, detail: result.status === 0 ? "" : String(result.error?.message ?? "") };
    },
  };
}
