import type { EditRequest } from "../transport.types";

export type ReviewStatus = "waiting" | "inFlight";

export interface QueuedReview {
  id: string;
  request: EditRequest;
  status: ReviewStatus;
}

export interface QueueState {
  reviews: QueuedReview[];
}

export interface TakeResult {
  state: QueueState;
  review: QueuedReview | null;
}
