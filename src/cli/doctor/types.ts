import type { DetectAdapters } from "../../multiplexers/multiplexer.types";

export interface DoctorCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface DoctorOptions {
  homeDir?: string;
  installRoot?: string;
  resolvesOnPath?: (command: string) => boolean;
  openTty?: () => number;
  multiplexerAdapters?: DetectAdapters;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  exitCode: number;
  text: string;
}
