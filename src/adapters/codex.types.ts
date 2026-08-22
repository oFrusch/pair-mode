import type { EditItem } from "../core/simulate.types";

export interface ParsedPatch {
  filePath: string;
  tool: "Write" | "MultiEdit";
  content?: string;
  edits?: EditItem[];
}
