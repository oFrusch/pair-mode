import { describe, test, expect } from "vitest";
import {
  complete,
  emptyQueue,
  enqueue,
  findReview,
  offerAll,
  release,
  waitingDepth,
} from "../src/transports/session";
import type { EditRequest } from "../src/transports";

function requestFor(name: string): EditRequest {
  return { tool: "edit", filePath: `/repo/${name}.ts`, before: "a", after: "b" };
}

test("an empty queue has nothing waiting and hands back no review", () => {
  const state = emptyQueue();

  expect(waitingDepth(state)).toBe(0);
  expect(offerAll(state).reviews).toEqual([]);
});

test("enqueue leaves the original state untouched", () => {
  const first = emptyQueue();
  const second = enqueue(first, "a1", requestFor("one"));

  expect(waitingDepth(first)).toBe(0);
  expect(waitingDepth(second)).toBe(1);
});

test("complete removes the review entirely", () => {
  const state = enqueue(emptyQueue(), "a1", requestFor("one"));
  const after = complete(state, "a1");

  expect(findReview(after, "a1")).toBeNull();
  expect(waitingDepth(after)).toBe(0);
});

test("findReview returns the queued review and its request", () => {
  const state = enqueue(emptyQueue(), "a1", requestFor("one"));

  expect(findReview(state, "a1")?.request.filePath).toBe("/repo/one.ts");
  expect(findReview(state, "missing")).toBeNull();
});

describe("offerAll", () => {
  test("marks every waiting review offered and returns them in order", () => {
    let state = emptyQueue();
    state = enqueue(state, "a", requestFor("a.ts"));
    state = enqueue(state, "b", requestFor("b.ts"));

    const result = offerAll(state);

    expect(result.reviews.map((review) => review.id)).toEqual(["a", "b"]);
    expect(result.state.reviews.every((review) => review.status === "offered")).toBe(true);
  });

  test("returns nothing when every review is already offered", () => {
    let state = emptyQueue();
    state = enqueue(state, "a", requestFor("a.ts"));

    const first = offerAll(state);
    const second = offerAll(first.state);

    expect(second.reviews).toEqual([]);
    expect(second.state).toEqual(first.state);
  });

  test("leaves the input state untouched", () => {
    let state = emptyQueue();
    state = enqueue(state, "a", requestFor("a.ts"));

    offerAll(state);

    expect(state.reviews[0]?.status).toBe("waiting");
  });

  test("waitingDepth counts only reviews nobody has been offered", () => {
    let state = emptyQueue();
    state = enqueue(state, "a", requestFor("a.ts"));
    state = enqueue(state, "b", requestFor("b.ts"));

    expect(waitingDepth(state)).toBe(2);

    const offered = offerAll(state);

    expect(waitingDepth(offered.state)).toBe(0);
  });

  test("release returns an offered review to waiting", () => {
    let state = emptyQueue();
    state = enqueue(state, "a", requestFor("a.ts"));

    const offered = offerAll(state);
    const released = release(offered.state, "a");

    expect(released.reviews[0]?.status).toBe("waiting");
  });
});
