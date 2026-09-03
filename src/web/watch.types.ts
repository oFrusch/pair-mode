import type { SessionKey } from "../core/state";

export interface WebWatchOptions {
  directory: string;
  port: number;
  socketPath?: string;
  sessionKey?: SessionKey;
  token?: string;
}

export interface WebWatcher {
  url: string;
  socketPath: string;
  port: number;
  close(): Promise<void>;
}
