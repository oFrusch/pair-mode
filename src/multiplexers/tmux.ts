import { randomBytes } from "node:crypto";
import type { Multiplexer, PaneSize, RunResult, Spawn } from "./multiplexer.types";
import type { PathResolver } from "../helpers/types";
import { defaultResolvesOnPath } from "../helpers/resolvesOnPath";
import { defaultSpawn } from "../helpers/spawn";

const CHANNEL_BYTES = 8;

const SAFE_UNQUOTED = /^[A-Za-z0-9_\-./]+$/;

// A single-quoted shell literal survives spaces and every other special character.
function shellQuote(value: string): string {
  if (SAFE_UNQUOTED.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function createTmuxMultiplexer(
  spawn: Spawn = defaultSpawn,
  resolvesOnPath: PathResolver = defaultResolvesOnPath,
): Multiplexer {
  return {
    name: "tmux",

    available(): boolean {
      return Boolean(process.env["TMUX"]) && resolvesOnPath("tmux");
    },

    run(argv: string[], size: PaneSize): RunResult {
      // tmux latches an unconsumed -S signal, so a reused channel name would wake the next wait instantly.
      const channel = `pair-${randomBytes(CHANNEL_BYTES).toString("hex")}`;
      const inner = argv.map(shellQuote).join(" ");
      const script = `stty -ixon 2>/dev/null; ${inner}; tmux wait-for -S ${channel}`;

      const popup = spawn("tmux", [
        "display-popup",
        "-E",
        "-w",
        size.width,
        "-h",
        size.height,
        script,
      ]);

      if (popup.status !== 0) {
        return { ok: false, detail: popup.stderr };
      }

      // display-popup returns immediately, so block here on the channel it signals.
      const wait = spawn("tmux", ["wait-for", channel]);

      return { ok: wait.status === 0, detail: wait.status === 0 ? "" : wait.stderr };
    },
  };
}
