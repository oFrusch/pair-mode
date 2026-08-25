import { mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { test, expect, beforeEach } from "vitest";
import {
  stateDir,
  flagPath,
  isEnabled,
  enable,
  disable,
  sessionSocketPath,
  findSessionSocket,
} from "../src/core/state";
import { useIsolatedHome } from "./helpers/env";

const isolated = useIsolatedHome();

let repoRoot: string;

beforeEach(() => {
  repoRoot = realpathSync(isolated.tempDir("pair-mode-repo-"));
});

test("stateDir honours XDG_STATE_HOME", () => {
  expect(stateDir()).toBe(join(isolated.stateHome, "pair-mode"));
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

test("findSessionSocket walks up from the edited file to the directory holding the socket", () => {
  const root = realpathSync(isolated.tempDir("pair-mode-walk-"));
  const nested = join(root, "src", "deep");
  mkdirSync(nested, { recursive: true });

  expect(findSessionSocket(join(nested, "file.ts"))).toBeNull();

  const socket = sessionSocketPath(root);
  mkdirSync(dirname(socket), { recursive: true });
  writeFileSync(socket, "");

  expect(findSessionSocket(join(nested, "file.ts"))).toBe(socket);
});
