export interface SessionServerOptions {
  socketPath: string;
  generateId?: () => string;
  onError?: (error: Error) => void;
}

export interface SessionServer {
  socketPath: string;
  clientCount(): number;
  lastAttachAt(): string | null;
  waitingDepth(): number;
  onChange(handler: () => void): void;
  close(): Promise<void>;
}
