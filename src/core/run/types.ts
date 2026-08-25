import type { PaneDeps, ReviewTransport } from "../../transports";

// A test injects a whole transport here, or just the pane transport's editor and multiplexer.
export interface RunDeps extends PaneDeps {
  transport?: ReviewTransport;
}

// reviewed distinguishes an allow the user actually saw in the pane from an allow pair mode never showed them.
export type RunVerdict =
  | { decision: "allow"; reviewed: true }
  | { decision: "allow"; reviewed: false; reason?: string }
  | { decision: "deny"; reason: string };

export type { EditRequest } from "../../transports";
