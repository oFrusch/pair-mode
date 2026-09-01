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
