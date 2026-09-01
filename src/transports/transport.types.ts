import type { PairConfig, TransportName } from "../core/config";
import type { Question } from "../core/collect";

export interface EditRequest {
  tool: string;
  filePath: string;
  before: string;
  after: string;
  sessionId?: string;
}

// reviewed distinguishes a review the user actually saw from one the transport could not present.
export type ReviewOutcome =
  | { reviewed: true; questions: Question[] }
  | { reviewed: false; detail: string };

export interface ReviewTransport {
  name: TransportName;
  review(request: EditRequest, config: PairConfig): Promise<ReviewOutcome>;
}
