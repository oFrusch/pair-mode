import type { SessionKind } from "../../core/state";

export interface SessionListing {
  id: string;
  kind: SessionKind;
  label: string;
  directory: string;
  clients: number;
  waiting: number;
  createdAt: string;
  alive: boolean;
}

export interface SessionsResult {
  listings: SessionListing[];
  swept: string[];
  text: string;
  exitCode: number;
}
