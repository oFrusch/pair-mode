import type { SessionKey } from "../core/state";

export interface WebWatchOptions {
  directory: string;
  port: number;
  socketPath?: string;
  sessionKey?: SessionKey;
  agentSessionId?: string;
  agentKind?: string;
  token?: string;
}

export interface WebWatcher {
  url: string;
  socketPath: string;
  port: number;
  owns: boolean;
  close(): Promise<void>;
}
