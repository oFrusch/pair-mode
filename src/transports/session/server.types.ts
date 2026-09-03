import type { SessionRecord } from "../../core/state";

export interface SessionServerOptions {
  socketPath: string;
  generateId?: () => string;
  onError?: (error: Error) => void;
  record?: SessionRecord;
}

export interface SessionServer {
  socketPath: string;
  clientCount(): number;
  lastAttachAt(): string | null;
  waitingDepth(): number;
  onChange(handler: () => void): void;
  close(): Promise<void>;
}
