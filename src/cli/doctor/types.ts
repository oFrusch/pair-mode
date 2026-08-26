import type { DetectAdapters } from "../../multiplexers/multiplexer.types";
import type { PairConfig } from "../../core/config";

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
  directory?: string;
  probeSocket?: (path: string) => Promise<boolean>;
  // An explicit config replaces the file read, so a test states the transport it is asserting about.
  config?: PairConfig;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  exitCode: number;
  text: string;
}
