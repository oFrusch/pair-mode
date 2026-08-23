import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, beforeEach, afterEach } from "vitest";
import { stateDir, flagPath, isEnabled, enable, disable } from "../src/core/state";

let xdgStateHome: string;
let originalXdgStateHome: string | undefined;
let originalHome: string | undefined;
let repoRoot: string;

beforeEach(() => {
  xdgStateHome = mkdtempSync(join(tmpdir(), "pair-mode-state-"));
  originalXdgStateHome = process.env["XDG_STATE_HOME"];
  process.env["XDG_STATE_HOME"] = xdgStateHome;

  originalHome = process.env["HOME"];
  process.env["HOME"] = mkdtempSync(join(tmpdir(), "pair-mode-home-"));

  const scratch = mkdtempSync(join(tmpdir(), "pair-mode-repo-"));
  repoRoot = realpathSync(scratch);
});

afterEach(() => {
  if (originalXdgStateHome === undefined) {
    delete process.env["XDG_STATE_HOME"];
  } else {
    process.env["XDG_STATE_HOME"] = originalXdgStateHome;
  }

  if (originalHome === undefined) {
    delete process.env["HOME"];
  } else {
    process.env["HOME"] = originalHome;
  }
});

test("stateDir honours XDG_STATE_HOME", () => {
  expect(stateDir()).toBe(join(xdgStateHome, "pair-mode"));
});

test("flagPath keys by the real path of the directory", () => {
  const path = flagPath(repoRoot);

  expect(path.startsWith(stateDir())).toBe(true);
  expect(path.endsWith(".on")).toBe(true);
});

test("isEnabled is false with no flag file", () => {
  const filePath = join(repoRoot, "file.txt");
  writeFileSync(filePath, "hello", "utf-8");

  expect(isEnabled(filePath)).toBe(false);
});

test("enable on a parent directory makes isEnabled true for a file three levels below it", () => {
  const nested = join(repoRoot, "a", "b", "c");
  mkdirSync(nested, { recursive: true });
  const filePath = join(nested, "file.txt");
  writeFileSync(filePath, "hello", "utf-8");

  enable(repoRoot);

  expect(isEnabled(filePath)).toBe(true);
});

test("isEnabled is true for a nonexistent nested path under an enabled parent directory", () => {
  enable(repoRoot);

  const missingPath = join(repoRoot, "a", "b", "c", "not-yet-written.txt");

  expect(isEnabled(missingPath)).toBe(true);
});

test("enable returns the flag path and disable removes it", () => {
  const path = enable(repoRoot);

  expect(path).toBe(flagPath(repoRoot));

  const removed = disable(repoRoot);

  expect(removed).toBe(true);
  expect(isEnabled(join(repoRoot, "file.txt"))).toBe(false);
});

test("disable returns false when no flag file exists", () => {
  expect(disable(repoRoot)).toBe(false);
});
