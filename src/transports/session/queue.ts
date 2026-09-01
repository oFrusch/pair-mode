import type { EditRequest } from "../transport.types";
import type { OfferResult, QueuedReview, QueueState } from "./queue.types";

export function emptyQueue(): QueueState {
  return { reviews: [] };
}

export function enqueue(state: QueueState, id: string, request: EditRequest): QueueState {
  const review: QueuedReview = { id, request, status: "waiting" };
  return { reviews: [...state.reviews, review] };
}

export function findReview(state: QueueState, id: string): QueuedReview | null {
  return state.reviews.find((review) => review.id === id) ?? null;
}

export function waitingDepth(state: QueueState): number {
  return state.reviews.filter((review) => review.status === "waiting").length;
}

// Every attached client sees every review, so the queue offers them all at once rather than handing one to one client.
export function offerAll(state: QueueState): OfferResult {
  const waiting = state.reviews.filter((review) => review.status === "waiting");

  if (waiting.length === 0) {
    return { state, reviews: [] };
  }

  const offered = waiting.map((review): QueuedReview => ({ ...review, status: "offered" }));
  const byId = new Map(offered.map((review) => [review.id, review]));

  const reviews = state.reviews.map((review) => byId.get(review.id) ?? review);

  return { state: { reviews }, reviews: offered };
}

export function complete(state: QueueState, id: string): QueueState {
  return { reviews: state.reviews.filter((review) => review.id !== id) };
}

// A client that drops mid-review hands its review back, so the next client to attach picks it up.
export function release(state: QueueState, id: string): QueueState {
  const reviews = state.reviews.map((review) =>
    review.id === id ? { ...review, status: "waiting" as const } : review,
  );

  return { reviews };
}
