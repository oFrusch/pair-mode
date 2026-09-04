import type { SessionKind } from "../../core/state";

// The probe lives in the transport, so a session listing and a watcher read the same three outcomes.
export type { SessionProbe } from "../../transports/session";

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
