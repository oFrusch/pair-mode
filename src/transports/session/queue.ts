import type { EditRequest } from "../transport.types";
import type { QueuedReview, QueueState, TakeResult } from "./queue.types";

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

// The head waiting review becomes inFlight. A queue with nothing waiting returns the same state.
export function takeNext(state: QueueState): TakeResult {
  const next = state.reviews.find((review) => review.status === "waiting");

  if (next === undefined) {
    return { state, review: null };
  }

  const taken: QueuedReview = { ...next, status: "inFlight" };
  const reviews = state.reviews.map((review) => (review.id === next.id ? taken : review));

  return { state: { reviews }, review: taken };
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
