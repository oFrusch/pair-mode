import type { PathResolver } from "../../helpers/types";
import type { BundleExistsChecker } from "../../editors/pair.types";

export type CliName = "claude-code" | "codex" | "opencode" | "pi";

export type { PathResolver };

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
  checkPairBundle?: BundleExistsChecker;
}
