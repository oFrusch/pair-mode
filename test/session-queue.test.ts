import { test, expect } from "vitest";
import {
  complete,
  emptyQueue,
  enqueue,
  findReview,
  release,
  takeNext,
  waitingDepth,
} from "../src/transports/session";
import type { EditRequest } from "../src/transports";

function requestFor(name: string): EditRequest {
  return { tool: "edit", filePath: `/repo/${name}.ts`, before: "a", after: "b" };
}

test("an empty queue has nothing waiting and hands back no review", () => {
  const state = emptyQueue();

  expect(waitingDepth(state)).toBe(0);
  expect(takeNext(state).review).toBeNull();
});

test("enqueue leaves the original state untouched", () => {
  const first = emptyQueue();
  const second = enqueue(first, "a1", requestFor("one"));

  expect(waitingDepth(first)).toBe(0);
  expect(waitingDepth(second)).toBe(1);
});

test("takeNext marks the head review inFlight and drops it from the waiting depth", () => {
  const state = enqueue(enqueue(emptyQueue(), "a1", requestFor("one")), "a2", requestFor("two"));
  const result = takeNext(state);

  expect(result.review?.id).toBe("a1");
  expect(result.review?.status).toBe("inFlight");
  expect(waitingDepth(result.state)).toBe(1);
});

test("takeNext serves reviews in submit order", () => {
  const state = enqueue(enqueue(emptyQueue(), "a1", requestFor("one")), "a2", requestFor("two"));

  const first = takeNext(state);
  const second = takeNext(first.state);

  expect(first.review?.id).toBe("a1");
  expect(second.review?.id).toBe("a2");
  expect(second.review?.id).not.toBe(first.review?.id);
});

test("takeNext skips a review already inFlight", () => {
  const state = enqueue(emptyQueue(), "a1", requestFor("one"));
  const taken = takeNext(state);

  expect(takeNext(taken.state).review).toBeNull();
});

test("complete removes the review entirely", () => {
  const state = enqueue(emptyQueue(), "a1", requestFor("one"));
  const after = complete(state, "a1");

  expect(findReview(after, "a1")).toBeNull();
  expect(waitingDepth(after)).toBe(0);
});

test("release returns an inFlight review to waiting so another client can take it", () => {
  const state = enqueue(emptyQueue(), "a1", requestFor("one"));
  const taken = takeNext(state);
  const released = release(taken.state, "a1");

  expect(waitingDepth(released)).toBe(1);
  expect(takeNext(released).review?.id).toBe("a1");
});

test("findReview returns the queued review and its request", () => {
  const state = enqueue(emptyQueue(), "a1", requestFor("one"));

  expect(findReview(state, "a1")?.request.filePath).toBe("/repo/one.ts");
  expect(findReview(state, "missing")).toBeNull();
});
