import type { SessionKey } from "../core/state";

// One shape for every watcher the CLI starts, so `watch` and `connect` reach the same dispatch.
export interface WatchTarget {
  directory: string;
  sessionKey?: SessionKey;
  socketPath?: string;
  web: boolean;
}
