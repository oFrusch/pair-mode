import type { Question } from "../../core/collect";
import type { PairConfig } from "../../core/config";
import type { ReviewTransport } from "../../transports";

// A null head reviews the working tree, untracked files included.
export interface ReviewOptions {
  directory: string;
  base: string;
  head: string | null;
  approve: string;
  reject: string;
}

export type ParsedReviewArgs = { ok: true; options: ReviewOptions } | { ok: false; error: string };

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type GitRunner = (args: string[], cwd: string) => GitResult;

export interface ChangedFile {
  path: string;
  before: string;
  after: string;
}

export type FileRead = { ok: true; text: string } | { ok: false; error: string };

export type ChangedFiles =
  | { ok: true; root: string; files: ChangedFile[] }
  | { ok: false; error: string };

export interface FileNotes {
  path: string;
  questions: Question[];
}

// A test injects git, the transport, and the config, so no review spawns git or a pane for real.
export interface ReviewDeps {
  git?: GitRunner;
  transport?: ReviewTransport;
  config?: PairConfig;
}

// The shape a lace annotate binding reads from stdout.
export interface GateAnswer {
  answer: string;
  notes: string;
}

export type ReviewResult = { ok: true; answer: GateAnswer } | { ok: false; error: string };
