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

export interface SessionScan {
  listings: SessionListing[];
  swept: string[];
  expired: string[];
}

export interface SessionsResult extends SessionScan {
  text: string;
  exitCode: number;
}

// The picker hands back the whole listing, so the caller reads the kind and the directory rather than guessing them.
export interface ConnectResult {
  selected: SessionListing | null;
  exitCode: number;
}
