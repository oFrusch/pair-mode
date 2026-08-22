export interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
}

export interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}

export interface RegisterResult {
  path: string;
  changed: boolean;
  backupPath: string | null;
  error?: string;
  note?: string;
}
