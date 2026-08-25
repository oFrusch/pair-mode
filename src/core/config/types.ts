export type EditorName = "auto" | "pair" | "micro" | "nvim" | "vim" | "nano";
export type MultiplexerName = "auto" | "zellij" | "tmux" | "none";
export type Layout = "split" | "inline";
export type NotePosition = "panel" | "anchored";

export interface Theme {
  add: string;
  del: string;
  fold: string;
  rowBand: boolean;
}

export interface Pane {
  width: string;
  height: string;
}

export interface PairConfig {
  editor: EditorName | string[];
  multiplexer: MultiplexerName;
  layout: Layout;
  context: number;
  minFold: number;
  pane: Pane;
  theme: Theme;
  trace: boolean;
  autoApprove: boolean;
  notes: NotePosition;
  syntax: boolean;
}

export interface ConfigError {
  path: string;
  message: string;
}

export interface ConfigResult {
  config: PairConfig;
  errors: ConfigError[];
}
