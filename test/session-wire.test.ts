import { test, expect } from "vitest";
import { createLineReader, decodeLine, encode } from "../src/transports/session";
import type { WireMessage } from "../src/transports/session";

function roundTrip(message: WireMessage): WireMessage | null {
  return decodeLine(encode(message).trim());
}

test("encode terminates every message with a newline", () => {
  expect(encode({ type: "cancel", id: "a1" })).toBe('{"type":"cancel","id":"a1"}\n');
});

test("a submit message survives a round trip", () => {
  const message: WireMessage = {
    type: "submit",
    tool: "edit",
    path: "/repo/one.ts",
    before: "a",
    after: "b",
  };

  expect(roundTrip(message)).toEqual(message);
});

test("a review message survives a round trip", () => {
  const message: WireMessage = {
    type: "review",
    id: "a1",
    tool: "edit",
    path: "/repo/one.ts",
    before: "a",
    after: "b",
  };

  expect(roundTrip(message)).toEqual(message);
});

test("a verdict message survives a round trip with a null line number", () => {
  const message: WireMessage = {
    type: "verdict",
    id: "a1",
    questions: [{ line: null, code: "x", text: "why?" }],
  };

  expect(roundTrip(message)).toEqual(message);
});

test("an attach message survives a round trip", () => {
  expect(roundTrip({ type: "attach", client: "web" })).toEqual({ type: "attach", client: "web" });
});

test("decodeLine rejects an unknown client kind", () => {
  expect(decodeLine('{"type":"attach","client":"phone"}')).toBeNull();
});

test("decodeLine rejects a submit missing a field", () => {
  expect(decodeLine('{"type":"submit","tool":"edit","path":"/x"}')).toBeNull();
});

test("decodeLine rejects a verdict whose questions are malformed", () => {
  expect(decodeLine('{"type":"verdict","id":"a1","questions":[{"line":1}]}')).toBeNull();
});

test("decodeLine rejects an unknown message type", () => {
  expect(decodeLine('{"type":"shout","id":"a1"}')).toBeNull();
});

test("decodeLine returns null for a line that is not JSON", () => {
  expect(decodeLine("not json at all")).toBeNull();
});

test("decodeLine returns null for JSON that is not an object", () => {
  expect(decodeLine("[1,2,3]")).toBeNull();
});

test("a line reader holds a partial chunk until its newline arrives", () => {
  const read = createLineReader();

  expect(read('{"type":"canc')).toEqual([]);
  expect(read('el","id":"a1"}\n')).toEqual(['{"type":"cancel","id":"a1"}']);
});

test("a line reader splits several messages delivered in one chunk", () => {
  const read = createLineReader();

  expect(read("one\ntwo\nthree\n")).toEqual(["one", "two", "three"]);
});

test("a line reader drops blank lines between messages", () => {
  const read = createLineReader();

  expect(read("one\n\n\ntwo\n")).toEqual(["one", "two"]);
});

test("a status frame round trips", () => {
  expect(roundTrip({ type: "status" })).toEqual({ type: "status" });
});

test("a state frame round trips", () => {
  const message: WireMessage = {
    type: "state",
    clientCount: 2,
    waitingDepth: 1,
    lastAttachAt: "2026-09-01T10:00:00.000Z",
  };

  expect(roundTrip(message)).toEqual(message);
});

test("a state frame with a null lastAttachAt round trips", () => {
  const message: WireMessage = {
    type: "state",
    clientCount: 0,
    waitingDepth: 0,
    lastAttachAt: null,
  };

  expect(roundTrip(message)).toEqual(message);
});

test("decodeLine rejects a state frame with a non-numeric count", () => {
  const line = JSON.stringify({
    type: "state",
    clientCount: "two",
    waitingDepth: 0,
    lastAttachAt: null,
  });

  expect(decodeLine(line)).toBeNull();
});
