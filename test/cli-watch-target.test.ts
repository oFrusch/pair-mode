import { test, expect, describe } from "vitest";
import { usesWebWatcher } from "../src/cli/watch-target";
import type { WatchTarget } from "../src/cli/watch-target.types";

function target(overrides: Partial<WatchTarget> = {}): WatchTarget {
  return { directory: "/repo", web: false, ...overrides };
}

describe("usesWebWatcher", () => {
  test("a plain watch stays in the terminal", () => {
    expect(usesWebWatcher(target(), false)).toBe(false);
  });

  test("--web asks for the browser", () => {
    expect(usesWebWatcher(target({ web: true }), false)).toBe(true);
  });

  test("the config turns a plain watch into a browser watch", () => {
    expect(usesWebWatcher(target(), true)).toBe(true);
  });

  test("a run that joins another watcher's session ignores the config", () => {
    expect(usesWebWatcher(target({ terminalOnly: true }), true)).toBe(false);
  });

  test("a run that joins another watcher's session ignores --web too", () => {
    expect(usesWebWatcher(target({ terminalOnly: true, web: true }), true)).toBe(false);
  });
});
