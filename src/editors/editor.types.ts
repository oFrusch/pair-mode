import type { PairConfig, Theme } from "../core/config";
import type { PathResolver } from "../helpers/types";

export interface EditorLaunch {
  argv: string[];
  env: Record<string, string>;
}

export interface EditorContext {
  leftFile: string;
  rightFile: string;
  resultFile: string;
  sourcePath: string;
  theme: Theme;
  configDir: string;
  config: PairConfig;
}

export interface Editor {
  name: "micro" | "vim" | "nvim" | "nano" | "custom" | "pair";
  collectMode: "buffer-diff" | "result-file";
  available(): boolean;
  prepare(context: EditorContext): EditorLaunch;
  bufferSuffix(sourcePath: string): string;
  headerHint(): string[];
}

export type { PathResolver };
