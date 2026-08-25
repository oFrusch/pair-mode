import { test, expect } from "vitest";
import { renderIdle } from "../src/cli/watch";
import type { IdleStatus } from "../src/cli/watch";

const WIDTH = 60;

const ESCAPE_CHAR = String.fromCharCode(27);
const CSI_PATTERN = "\\[[0-9;]*m";
const ANSI_ESCAPE_PATTERN = new RegExp(ESCAPE_CHAR + CSI_PATTERN, "g");

function statusWith(clients: number, waiting: number): IdleStatus {
  return { directory: "/repo", socketPath: "/state/sessions/abc.sock", clients, waiting };
}

function plain(lines: string[]): string[] {
  return lines.map((line) => line.replace(ANSI_ESCAPE_PATTERN, ""));
}

test("the idle screen names the session directory and the socket", () => {
  const lines = plain(renderIdle(statusWith(1, 0), WIDTH, true));

  expect(lines.some((line) => line.includes("/repo"))).toBe(true);
  expect(lines.some((line) => line.includes("/state/sessions/abc.sock"))).toBe(true);
});

test("the idle screen reports an empty queue as a word", () => {
  const lines = plain(renderIdle(statusWith(1, 0), WIDTH, true));

  expect(lines.some((line) => line.includes("queue") && line.includes("empty"))).toBe(true);
});

test("the idle screen pluralises the queue depth", () => {
  const one = plain(renderIdle(statusWith(1, 1), WIDTH, true));
  const two = plain(renderIdle(statusWith(1, 2), WIDTH, true));

  expect(one.some((line) => line.includes("1 review"))).toBe(true);
  expect(two.some((line) => line.includes("2 reviews"))).toBe(true);
});

test("the idle screen pluralises the client count", () => {
  const one = plain(renderIdle(statusWith(1, 0), WIDTH, true));
  const two = plain(renderIdle(statusWith(2, 0), WIDTH, true));

  expect(one.some((line) => line.includes("1 client"))).toBe(true);
  expect(two.some((line) => line.includes("2 clients"))).toBe(true);
});

test("the idle screen names the quit key", () => {
  const lines = plain(renderIdle(statusWith(1, 0), WIDTH, true));

  expect(lines.some((line) => line.includes("q quits"))).toBe(true);
});

test("the idle heading fills the terminal width", () => {
  const heading = plain(renderIdle(statusWith(1, 0), WIDTH, true))[0] ?? "";

  expect(heading).toHaveLength(WIDTH);
});

test("the idle heading never overruns a narrow terminal", () => {
  const heading = plain(renderIdle(statusWith(1, 0), 8, true))[0] ?? "";

  expect(heading).toHaveLength(8);
});
