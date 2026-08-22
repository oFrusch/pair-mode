export type CliName = "claude-code" | "codex" | "opencode" | "pi";

export type PathResolver = (command: string) => boolean;

export interface CliDetection {
  name: CliName;
  present: boolean;
  configPath: string;
}

export interface MultiplexerDetection {
  name: string;
  onPath: boolean;
}

export interface EditorDetection {
  name: string;
  onPath: boolean;
}

export interface InstallReport {
  clis: CliDetection[];
  multiplexers: MultiplexerDetection[];
  insideMultiplexer: string | null;
  editors: EditorDetection[];
}

export interface DetectAdapters {
  resolvesOnPath?: PathResolver;
  homeDir?: string;
}
