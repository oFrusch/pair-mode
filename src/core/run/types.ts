import type { Multiplexer } from "../../multiplexers/multiplexer.types";
import type { Editor } from "../../editors/editor.types";

export interface EditRequest {
  tool: string;
  filePath: string;
  before: string;
  after: string;
}

// A test injects its own multiplexer and editor here so runPair never spawns zellij, tmux, or an editor for real.
export interface RunDeps {
  multiplexer?: Multiplexer;
  editor?: Editor;
}

// reviewed distinguishes an allow the user actually saw in the pane from an allow pair mode never showed them.
export type RunVerdict =
  | { decision: "allow"; reviewed: true }
  | { decision: "allow"; reviewed: false; reason?: string }
  | { decision: "deny"; reason: string };
