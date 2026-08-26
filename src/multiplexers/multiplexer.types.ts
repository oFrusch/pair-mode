import type { Pane } from "../core/config";
import type { Spawn, SpawnResult } from "../helpers/types";

export type PaneSize = Pane;

export interface RunResult {
  ok: boolean;
  detail: string;
}

export interface Multiplexer {
  name: "zellij" | "tmux" | "none";
  available(): boolean;
  run(argv: string[], size: PaneSize): RunResult;
}

export type { Spawn, SpawnResult };

export type TtyOpen = () => number;

export type TtyRunner = (command: string, args: string[], fd: number) => RunResult;

export interface DetectAdapters {
  zellij?: Multiplexer;
  tmux?: Multiplexer;
  tty?: Multiplexer;
}
