import type { Pane } from "../core/config.types";

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

export interface SpawnResult {
  status: number | null;
  stderr: string;
}

export type Spawn = (command: string, args: string[]) => SpawnResult;

export type TtyOpen = () => number;

export type TtyRunner = (command: string, args: string[], fd: number) => RunResult;

export interface DetectAdapters {
  zellij?: Multiplexer;
  tmux?: Multiplexer;
  tty?: Multiplexer;
}
