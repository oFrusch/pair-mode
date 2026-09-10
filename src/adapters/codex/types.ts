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

// One file section of a patch: its "*** ... File:" header and every line up to the next header.
export interface PatchSection {
  header: string;
  body: string[];
}

// The raw lines of one hunk before classification, kept with the "@@" context that locates them.
export interface HunkGroup {
  context: string | null;
  raw: string[];
}
