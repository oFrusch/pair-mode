import type { TuiIo } from "../../tui";

export interface IdleStatus {
  directory: string;
  socketPath: string;
  clients: number;
  waiting: number;
}

// runTui calls onKey and cleanup once per review, so a watcher IO replaces its handler instead of stacking one.
export interface WatchIo extends TuiIo {
  onResize(handler: () => void): void;
  shutdown(): void;
}

export interface WatchOptions {
  directory: string;
  socketPath?: string;
  io?: WatchIo;
}
