import { test, expect } from "vitest";
import { toPositiveInteger } from "../src/tui/cli";
import { DEFAULT_CONTEXT, DEFAULT_MIN_FOLD } from "../src/core/marks";

test("toPositiveInteger parses a valid numeric string", () => {
  expect(toPositiveInteger("20", DEFAULT_CONTEXT)).toBe(20);
});

test("toPositiveInteger falls back on a missing value", () => {
  expect(toPositiveInteger(undefined, DEFAULT_CONTEXT)).toBe(DEFAULT_CONTEXT);
});

test("toPositiveInteger falls back on a non-numeric value", () => {
  expect(toPositiveInteger("nope", DEFAULT_MIN_FOLD)).toBe(DEFAULT_MIN_FOLD);
});

test("toPositiveInteger falls back on zero", () => {
  expect(toPositiveInteger("0", DEFAULT_MIN_FOLD)).toBe(DEFAULT_MIN_FOLD);
});

test("toPositiveInteger falls back on a negative value", () => {
  expect(toPositiveInteger("-3", DEFAULT_CONTEXT)).toBe(DEFAULT_CONTEXT);
});

test("toPositiveInteger falls back on a fractional value", () => {
  expect(toPositiveInteger("2.5", DEFAULT_CONTEXT)).toBe(DEFAULT_CONTEXT);
});
