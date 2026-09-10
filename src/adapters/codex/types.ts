export interface HunkLine {
  old: string | null;
  new: string | null;
}

// context is the "@@ <ctx>" text that locates the hunk before its old/new lines are matched.
export interface Hunk {
  context: string | null;
  lines: HunkLine[];
}

export interface ParsedPatch {
  filePath: string;
  tool: "Write" | "MultiEdit";
  content?: string;
  hunks?: Hunk[];
}
