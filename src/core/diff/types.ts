export type OpcodeTag = "equal" | "insert" | "delete" | "replace";

export interface Opcode {
  tag: OpcodeTag;
  i1: number;
  i2: number;
  j1: number;
  j2: number;
}

export interface Row {
  changed: boolean;
  left: string;
  right: string;
  number: number | null;
}

export interface Panes {
  left: string[];
  right: string[];
  numbers: (number | null)[];
}
