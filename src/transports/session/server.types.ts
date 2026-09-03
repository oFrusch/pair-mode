import type { Socket } from "node:net";
import type { SessionRecord } from "../../core/state";

export type ReviewId = string;

export type ClientId = string;

// A review client is a watcher pane, so it carries an id the server can name it by.
export interface Client {
  id: ClientId;
  socket: Socket;
}

export type Clients = Map<ClientId, Client>;

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
