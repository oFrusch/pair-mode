export interface SessionServerOptions {
  socketPath: string;
  generateId?: () => string;
}

export interface SessionServer {
  socketPath: string;
  clientCount(): number;
  waitingDepth(): number;
  onChange(handler: () => void): void;
  close(): Promise<void>;
}
