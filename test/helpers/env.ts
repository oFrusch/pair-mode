import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach } from "vitest";
import type { IsolatedHome, IsolatedHomeOptions } from "./env.types";

const HOME_VARS = ["HOME", "XDG_STATE_HOME", "XDG_CONFIG_HOME"];

// Every test gets a private home, so nothing reads the developer's real config or state.
export function useIsolatedHome(options: IsolatedHomeOptions = {}): IsolatedHome {
  const cleared = options.clear ?? [];

  let created: string[] = [];
  let stashed: ReadonlyMap<string, string | undefined> = new Map();

  let home = "";
  let stateHome = "";
  let configHome = "";

  function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    created = [...created, dir];

    return dir;
  }

  beforeEach(() => {
    stashed = new Map([...HOME_VARS, ...cleared].map((name) => [name, process.env[name]] as const));

    home = tempDir("pair-mode-home-");
    stateHome = tempDir("pair-mode-state-");
    configHome = tempDir("pair-mode-config-");

    process.env["HOME"] = home;
    process.env["XDG_STATE_HOME"] = stateHome;
    process.env["XDG_CONFIG_HOME"] = configHome;

    cleared.forEach((name) => delete process.env[name]);
  });

  afterEach(() => {
    stashed.forEach((value, name) => {
      if (value === undefined) {
        delete process.env[name];
        return;
      }

      process.env[name] = value;
    });

    created.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
    created = [];
  });

  return {
    get home() {
      return home;
    },
    get stateHome() {
      return stateHome;
    },
    get configHome() {
      return configHome;
    },
    tempDir,
  };
}
