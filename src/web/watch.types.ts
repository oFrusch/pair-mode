export interface WebWatchOptions {
  directory: string;
  port: number;
  socketPath?: string;
  token?: string;
}

export interface WebWatcher {
  url: string;
  socketPath: string;
  port: number;
  close(): Promise<void>;
}
