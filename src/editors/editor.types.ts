import type { Theme } from "../core/config.types";

export interface EditorLaunch {
  argv: string[];
  env: Record<string, string>;
}

export interface EditorContext {
  leftFile: string;
  rightFile: string;
  sourcePath: string;
  theme: Theme;
  configDir: string;
}

export interface Editor {
  name: "micro" | "vim" | "nvim" | "nano";
  available(): boolean;
  prepare(context: EditorContext): EditorLaunch;
  bufferSuffix(sourcePath: string): string;
}

export type PathResolver = (command: string) => boolean;
