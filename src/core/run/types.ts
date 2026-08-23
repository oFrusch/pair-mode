export interface EditRequest {
  tool: string;
  filePath: string;
  before: string;
  after: string;
}

// reviewed distinguishes an allow the user actually saw in the pane from an allow pair mode never showed them.
export type RunVerdict =
  | { decision: "allow"; reviewed: true }
  | { decision: "allow"; reviewed: false; reason?: string }
  | { decision: "deny"; reason: string };
