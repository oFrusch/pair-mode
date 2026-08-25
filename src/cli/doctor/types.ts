import type { DetectAdapters } from "../../multiplexers/multiplexer.types";

export interface DoctorCheck {
  name: string;
  passed: boolean;
  detail: string;
  // A failing check with warnOnly true is reported as WARN and does not fail the doctor exit code.
  warnOnly?: boolean;
}

export interface DoctorOptions {
  homeDir?: string;
  installRoot?: string;
  resolvesOnPath?: (command: string) => boolean;
  openTty?: () => number;
  multiplexerAdapters?: DetectAdapters;
  resolvesShiki?: () => boolean;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  exitCode: number;
  text: string;
}
