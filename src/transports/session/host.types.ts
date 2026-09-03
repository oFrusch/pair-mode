import type { SessionRecord } from "../../core/state";
import type { Question } from "../../core/collect";
import type { ClientKind, ReviewMessage } from "./wire.types";

export interface HostCounts {
  clients: number;
  waiting: number;
}

// A watcher talks to its session through this, so the owner and the viewer share one surface.
export interface SessionHost {
  socketPath: string;
  owns: boolean;
  counts(): HostCounts;
  refreshCounts(): void;
  verdict(id: string, questions: Question[]): void;
  onReview(handler: (review: ReviewMessage) => void): void;
  onCancel(handler: (id: string) => void): void;
  onChange(handler: () => void): void;
  close(): Promise<void>;
}

export interface SessionHostOptions {
  socketPath: string;
  client: ClientKind;
  record?: SessionRecord;
  onError?: (error: Error) => void;
}
