import type { Multiplexer } from "../../multiplexers/multiplexer.types";
import type { Editor } from "../../editors/editor.types";

// A test injects its own multiplexer and editor here so the pane transport never spawns zellij, tmux, or an editor for real.
export interface PaneDeps {
  multiplexer?: Multiplexer;
  editor?: Editor;
}
