import { test, expect, describe } from "vitest";
import { useIsolatedHome } from "./helpers/env";
import {
  sessionKey,
  sessionKeySocketPath,
  sessionKeyFlagPath,
  sessionKeyOptOutPath,
  sessionKeyRecordPath,
  sessionKeyUrlPath,
} from "../src/core/state";

useIsolatedHome();

describe("sessionKey", () => {
  test("prefixes eight hex characters with s-", () => {
    const key = sessionKey("d95655de-eb7f-45e5-867d-9797a355353e");

    expect(key).toMatch(/^s-[0-9a-f]{8}$/);
  });

  test("is stable for the same agent session id", () => {
    const first = sessionKey("d95655de-eb7f-45e5-867d-9797a355353e");
    const second = sessionKey("d95655de-eb7f-45e5-867d-9797a355353e");

    expect(first).toBe(second);
  });

  test("differs for a different agent session id", () => {
    const first = sessionKey("d95655de-eb7f-45e5-867d-9797a355353e");
    const second = sessionKey("11111111-2222-3333-4444-555555555555");

    expect(first).not.toBe(second);
  });
});

describe("session key paths", () => {
  test("every path lives under the sessions directory and carries the key", () => {
    const key = sessionKey("d95655de-eb7f-45e5-867d-9797a355353e");

    const paths = [
      sessionKeySocketPath(key),
      sessionKeyFlagPath(key),
      sessionKeyOptOutPath(key),
      sessionKeyRecordPath(key),
      sessionKeyUrlPath(key),
    ];

    paths.forEach((path) => {
      expect(path).toContain("/sessions/");
      expect(path).toContain(key);
    });
  });

  test("each path uses its own extension", () => {
    const key = sessionKey("d95655de-eb7f-45e5-867d-9797a355353e");

    expect(sessionKeySocketPath(key).endsWith(".sock")).toBe(true);
    expect(sessionKeyFlagPath(key).endsWith(".on")).toBe(true);
    expect(sessionKeyOptOutPath(key).endsWith(".off")).toBe(true);
    expect(sessionKeyRecordPath(key).endsWith(".json")).toBe(true);
    expect(sessionKeyUrlPath(key).endsWith(".url")).toBe(true);
  });

  test("XDG_STATE_HOME decides the root", () => {
    const key = sessionKey("abc");

    expect(sessionKeySocketPath(key).startsWith(process.env["XDG_STATE_HOME"] ?? "")).toBe(true);
  });
});

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  isEnabled,
  enable,
  enableSession,
  optOutSession,
  sessionFlagState,
} from "../src/core/state";

describe("the three-state flag", () => {
  const agentId = "d95655de-eb7f-45e5-867d-9797a355353e";

  function fileIn(directory: string): string {
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "main.ts");
    writeFileSync(path, "", "utf-8");
    return path;
  }

  test("an unset session with no directory flag reports off", () => {
    const isolated = process.env["XDG_STATE_HOME"] ?? "";
    const key = sessionKey(agentId);

    expect(sessionFlagState(key)).toBe("unset");
    expect(isEnabled(fileIn(join(isolated, "work")), key)).toBe(false);
  });

  test("a session flag turns pair mode on for that session", () => {
    const key = sessionKey(agentId);
    enableSession(key);

    expect(sessionFlagState(key)).toBe("on");
    expect(isEnabled(fileIn(join(process.env["XDG_STATE_HOME"] ?? "", "work")), key)).toBe(true);
  });

  test("a directory flag turns pair mode on for a session with no flag of its own", () => {
    const directory = join(process.env["XDG_STATE_HOME"] ?? "", "repo");
    const path = fileIn(directory);
    enable(directory);

    expect(isEnabled(path, sessionKey(agentId))).toBe(true);
  });

  test("a session opt-out beats a live directory flag", () => {
    const directory = join(process.env["XDG_STATE_HOME"] ?? "", "repo2");
    const path = fileIn(directory);
    enable(directory);

    const key = sessionKey(agentId);
    optOutSession(key);

    expect(sessionFlagState(key)).toBe("off");
    expect(isEnabled(path, key)).toBe(false);
  });

  test("the opt-out spares another session in the same directory", () => {
    const directory = join(process.env["XDG_STATE_HOME"] ?? "", "repo3");
    const path = fileIn(directory);
    enable(directory);

    optOutSession(sessionKey(agentId));

    const other = sessionKey("11111111-2222-3333-4444-555555555555");

    expect(isEnabled(path, other)).toBe(true);
  });

  test("enabling a session removes its opt-out", () => {
    const key = sessionKey(agentId);
    optOutSession(key);
    enableSession(key);

    expect(sessionFlagState(key)).toBe("on");
  });

  test("opting out removes the session flag", () => {
    const key = sessionKey(agentId);
    enableSession(key);
    optOutSession(key);

    expect(sessionFlagState(key)).toBe("off");
  });

  test("isEnabled with no key keeps its old directory-only behaviour", () => {
    const directory = join(process.env["XDG_STATE_HOME"] ?? "", "repo4");
    const path = fileIn(directory);

    expect(isEnabled(path)).toBe(false);

    enable(directory);

    expect(isEnabled(path)).toBe(true);
  });
});
