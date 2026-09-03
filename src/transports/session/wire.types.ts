import type { Question } from "../../core/collect";

export type ClientKind = "tui" | "web";

// The hook sends this and then waits. The server assigns the id, so the hook never invents one.
export interface SubmitMessage {
  type: "submit";
  tool: string;
  path: string;
  before: string;
  after: string;
}

export interface AttachMessage {
  type: "attach";
  client: ClientKind;
}

export interface ReviewMessage {
  type: "review";
  id: string;
  tool: string;
  path: string;
  before: string;
  after: string;
}

// The client sends this to answer a review, and the server relays the same shape back to the hook.
export interface VerdictMessage {
  type: "verdict";
  id: string;
  questions: Question[];
}

export interface CancelMessage {
  type: "cancel";
  id: string;
}

export interface StatusMessage {
  type: "status";
}

export interface StateMessage {
  type: "state";
  clientCount: number;
  waitingDepth: number;
  lastAttachAt: string | null;
}

export type ClientMessage = AttachMessage | VerdictMessage | StatusMessage;
export type AgentMessage = SubmitMessage;
export type ServerMessage = ReviewMessage | CancelMessage | VerdictMessage | StateMessage;

export type WireMessage =
  | SubmitMessage
  | AttachMessage
  | ReviewMessage
  | VerdictMessage
  | CancelMessage
  | StatusMessage
  | StateMessage;

export type LineReader = (chunk: string) => string[];
