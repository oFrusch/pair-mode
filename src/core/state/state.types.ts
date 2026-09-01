// The key names one agent coding session, and every per-session file uses it as a filename stem.
export type SessionKey = string;

export type SessionKind = "session" | "directory";

export type FlagState = "on" | "off" | "unset";

export interface SessionRecord {
  id: SessionKey;
  kind: SessionKind;
  label: string;
  directory: string;
  branch: string | null;
  agentSessionId: string | null;
  agentKind: string | null;
  createdAt: string;
  pid: number;
}
