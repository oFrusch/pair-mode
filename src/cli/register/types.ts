export interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
}

export interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}

export type JsonReadResult =
  | { ok: true; root: Record<string, unknown> }
  | { ok: false; error: string };

export interface RegisterResult {
  path: string;
  changed: boolean;
  backupPath: string | null;
  error?: string;
  note?: string;
}
