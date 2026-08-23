export interface Prompter {
  question(prompt: string): Promise<string>;
  close(): void;
}

export interface SetupOptions {
  prompter?: Prompter;
  homeDir?: string;
  installRoot?: string;
  resolvesOnPath?: (command: string) => boolean;
}

export interface SetupResult {
  changedFiles: string[];
  stopped: boolean;
  doctorExitCode: number;
}
