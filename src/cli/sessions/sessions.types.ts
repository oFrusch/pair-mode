import type { SessionKind } from "../../core/state";
import type { StateMessage } from "../../transports/session";

// A refused connect proves no listener owns the socket. A silent one proves nothing, so only refused sweeps.
export type SessionProbe =
  | { status: "answered"; state: StateMessage }
  | { status: "refused" }
  | { status: "silent" };

export interface SessionListing {
  id: string;
  kind: SessionKind;
  label: string;
  directory: string;
  clients: number | null;
  waiting: number | null;
  createdAt: string;
  alive: boolean;
}

export interface SessionsResult {
  listings: SessionListing[];
  swept: string[];
  text: string;
  exitCode: number;
}

export interface ConnectResult {
  selected: string | null;
  exitCode: number;
}
