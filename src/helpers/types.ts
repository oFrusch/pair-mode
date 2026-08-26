export type PathResolver = (command: string) => boolean;

export interface SpawnResult {
  status: number | null;
  stderr: string;
}

export type Spawn = (command: string, args: string[]) => SpawnResult;
