import { openSync, closeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { Multiplexer, PaneSize, RunResult, TtyOpen, TtyRunner } from "./multiplexer.types";

// The default open reaches the real controlling terminal, or throws ENXIO without one.
const defaultOpen: TtyOpen = () => openSync("/dev/tty", "r+");

// The default runner shells out for real, bound to the tty file descriptor.
const defaultRunner: TtyRunner = (command, args, fd): RunResult => {
  const result = spawnSync(command, args, { stdio: [fd, fd, fd] });
  const detail = result.status === 0 ? "" : String(result.error?.message ?? result.stderr ?? "");
  return { ok: result.status === 0, detail };
};

// Cleanup only. A close failure on a fake fd in a test must not fail the run.
function closeQuietly(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // ignore
  }
}

export function createTtyMultiplexer(
  open: TtyOpen = defaultOpen,
  runner: TtyRunner = defaultRunner,
): Multiplexer {
  return {
    name: "none",

    available(): boolean {
      try {
        closeQuietly(open());
        return true;
      } catch {
        return false;
      }
    },

    run(argv: string[], _size: PaneSize): RunResult {
      let fd: number;

      try {
        fd = open();
      } catch {
        return { ok: false, detail: "no controlling terminal (ENXIO)" };
      }

      const [command, ...args] = argv;

      if (!command) {
        closeQuietly(fd);
        return { ok: false, detail: "no command given" };
      }

      const result = runner(command, args, fd);
      closeQuietly(fd);

      return result;
    },
  };
}
