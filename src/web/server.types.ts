import type { Question } from "../core/collect";
import type { Layout } from "../core/config";
import type { WebReview } from "./review.types";

export type BodyResult = { kind: "ok"; body: string } | { kind: "too-large" } | { kind: "error" };

export interface WebServerOptions {
  port: number;
  token?: string;
  layout?: Layout;
  onVerdict(id: string, questions: Question[]): void;
}

export interface WebServer {
  url: string;
  port: number;
  token: string;
  viewerCount(): number;
  offer(review: WebReview): void;
  withdraw(id: string): void;
  close(): Promise<void>;
}
