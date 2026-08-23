export interface EditRequest {
  tool: string;
  filePath: string;
  before: string;
  after: string;
}

export type RunVerdict =
  | { decision: "allow"; reason?: string }
  | { decision: "deny"; reason: string };
