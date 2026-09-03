import type { EditRequest } from "../transport.types";

export type ReviewStatus = "waiting" | "offered";

export interface QueuedReview {
  id: string;
  request: EditRequest;
  status: ReviewStatus;
}

export interface QueueState {
  reviews: QueuedReview[];
}

export interface OfferResult {
  state: QueueState;
  reviews: QueuedReview[];
}
