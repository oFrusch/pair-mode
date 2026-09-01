# Multi-pair Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each agent coding session its own pair-mode socket, so concurrent sessions in one repository stop receiving each other's diffs.

**Architecture:** The agent's `session_id`, already present in every `PreToolUse` payload, keys a per-session socket and a per-session flag. The hook resolves a socket in three steps: the session socket, then a directory socket found by walking up, then fail open. The server broadcasts each review to every attached client rather than handing it to one. A new `sessions` command lists live sockets and sweeps dead ones.

**Tech Stack:** TypeScript, Node 22+, vitest, oxlint, oxfmt, esbuild, pnpm. Unix domain sockets via `node:net`. Newline-delimited JSON on the wire.

**Spec:** `docs/superpowers/specs/2026-09-01-multi-pair-sessions-design.md`

## Global Constraints

- Node `>=22`. `package.json` `engines.node` is `">=22"`.
- One line per comment, ever. A hook denies a write with a two-line comment. No ticket ids, no phase references, no provenance such as "review fix" or "added for X".
- No type-coercion `as` casts in code we author. `as const` is fine. Use generics, type guards, `satisfies`, or real signatures.
- Types live in a sibling `<module>.types.ts` or `types.ts`, never inline in the implementation file.
- Generous vertical whitespace. Blank lines between logical chunks.
- Never run `git push --force`. Never commit to `main`.
- Branch names follow `<type>/<descriptor>/<ticket-id>` with the type one of `feat`, `chore`, `bug`, `docs`.
- Create a branch with a bare `git checkout -b <name>` off a freshly pulled `main`. Never pass `origin/main` as a start point.
- Every task ends green: `pnpm run typecheck`, `pnpm run lint`, `pnpm run fmt:check`, `pnpm test`.
- The hook reads `session_id` from the payload only. The hook never reads the environment for identity, because a nested context leaks the outer session id.
- Existing directory socket filenames do not change. No state migrates.

---

## File Structure

**New files**

| Path | Responsibility |
| --- | --- |
| `src/core/state/state.types.ts` | `SessionKey`, `SessionKind`, `SessionRecord`, `FlagState` |
| `src/cli/sessions/sessions.ts` | Read every sidecar, probe each socket, sweep the dead, format the table |
| `src/cli/sessions/index.ts` | Re-export the module surface |
| `src/cli/sessions/sessions.types.ts` | `SessionListing`, `SessionsResult` |
| `src/cli/sessions/connect.ts` | The interactive picker |
| `test/state-session-keys.test.ts` | Key derivation and both resolution chains |
| `test/session-broadcast.test.ts` | Broadcast dispatch and first-verdict-wins |
| `test/cli-sessions.test.ts` | Listing, sweeping, and the picker |

**Modified files**

| Path | Change |
| --- | --- |
| `src/core/state/state.ts` | Key derivation, session paths, both resolution chains, three-state flag |
| `src/core/state/index.ts` | Export the new functions |
| `src/transports/transport.types.ts` | `EditRequest` gains `sessionId?: string` |
| `src/adapters/claude-code/claude-code.ts` | Read `session_id`, pass it to `isEnabled` and `simulate` |
| `src/adapters/codex/codex.ts` | Same |
| `src/core/simulate/simulate.ts` | Carry `sessionId` onto the `EditRequest` it builds |
| `src/core/run/run.ts` | Pass `request.sessionId` to `isEnabled` |
| `src/transports/session/client.ts` | Use the resolution chain |
| `src/cli/toggle.ts` | Session-scoped `on`, `off`, `toggle`, `status` |
| `src/cli/watch/watch.ts` | Accept a session key |
| `src/web/watch.ts` | Accept a session key |
| `src/transports/session/queue.ts` | Broadcast state instead of a single holder |
| `src/transports/session/queue.types.ts` | `ReviewStatus` drops `inFlight` |
| `src/transports/session/server.ts` | Broadcast dispatch, `status` frame, sidecar, `lastAttachAt` |
| `src/transports/session/server.types.ts` | `SessionServer` gains `lastAttachAt` |
| `src/transports/session/wire.ts` | Encode and decode `status` and `state` |
| `src/transports/session/wire.types.ts` | `StatusMessage`, `StateMessage` |
| `src/cli/index.ts` | Dispatch `sessions` and `connect`, `watch <id>`, USAGE |
| `src/cli/doctor/doctor.ts` | Remove a stale socket rather than suggest `rm` |

---

# PR 1 — Session keying

Branch: `feat/session-keyed-sockets/pm-16`

Create it before Task 1.

```bash
git checkout main
git pull
git checkout -b feat/session-keyed-sockets/pm-16
```

---

### Task 1: Session key derivation and path helpers

**Files:**
- Create: `src/core/state/state.types.ts`
- Modify: `src/core/state/state.ts`
- Modify: `src/core/state/index.ts`
- Test: `test/state-session-keys.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type SessionKey = string`
  - `type SessionKind = "session" | "directory"`
  - `sessionKey(agentSessionId: string): SessionKey` — returns `"s-"` plus 8 hex characters
  - `sessionKeySocketPath(key: SessionKey): string`
  - `sessionKeyFlagPath(key: SessionKey): string`
  - `sessionKeyOptOutPath(key: SessionKey): string`
  - `sessionKeyRecordPath(key: SessionKey): string`
  - `sessionKeyUrlPath(key: SessionKey): string`

- [ ] **Step 1: Write the failing test**

Create `test/state-session-keys.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/state-session-keys.test.ts`

Expected: FAIL. The error names `sessionKey` as not exported from `../src/core/state`.

- [ ] **Step 3: Write the types file**

Create `src/core/state/state.types.ts`:

```ts
// The key names one agent coding session, and every per-session file uses it as a filename stem.
export type SessionKey = string;

export type SessionKind = "session" | "directory";

export type FlagState = "on" | "off" | "unset";

export interface SessionRecord {
  id: SessionKey;
  kind: SessionKind;
  label: string;
  directory: string;
  branch: string | null;
  agentSessionId: string | null;
  agentKind: string | null;
  createdAt: string;
  pid: number;
}
```

- [ ] **Step 4: Add the key derivation and the path helpers**

In `src/core/state/state.ts`, add this import at the top, below the existing imports:

```ts
import type { SessionKey } from "./state.types";
```

Then add these functions after the existing `sessionUrlPath`:

```ts
const SESSION_KEY_LENGTH = 8;

// Eight hex characters stay short enough to type after `watch` and wide enough for the sessions one person opens.
export function sessionKey(agentSessionId: string): SessionKey {
  const digest = createHash("sha1").update(agentSessionId).digest("hex");
  return `s-${digest.slice(0, SESSION_KEY_LENGTH)}`;
}

function sessionKeyPath(key: SessionKey, extension: string): string {
  return join(sessionsDir(), `${key}${extension}`);
}

export function sessionKeySocketPath(key: SessionKey): string {
  return sessionKeyPath(key, ".sock");
}

export function sessionKeyFlagPath(key: SessionKey): string {
  return sessionKeyPath(key, ".on");
}

// A bare `pair-mode off` writes this, so a session opts out of a directory flag without clearing it for anyone else.
export function sessionKeyOptOutPath(key: SessionKey): string {
  return sessionKeyPath(key, ".off");
}

export function sessionKeyRecordPath(key: SessionKey): string {
  return sessionKeyPath(key, ".json");
}

export function sessionKeyUrlPath(key: SessionKey): string {
  return sessionKeyPath(key, ".url");
}
```

- [ ] **Step 5: Export from the module index**

Replace the export block in `src/core/state/index.ts` with:

```ts
export {
  stateDir,
  flagPath,
  isEnabled,
  enable,
  disable,
  sessionsDir,
  sessionSocketPath,
  sessionUrlPath,
  findSessionSocket,
  sessionKey,
  sessionKeySocketPath,
  sessionKeyFlagPath,
  sessionKeyOptOutPath,
  sessionKeyRecordPath,
  sessionKeyUrlPath,
} from "./state";

export type { SessionKey, SessionKind, FlagState, SessionRecord } from "./state.types";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/state-session-keys.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 7: Run the full gates**

Run: `npx vitest run && npx tsc --noEmit && npx oxlint && npx oxfmt --check`

Expected: all pass. The existing suite stays at its current count plus 6.

- [ ] **Step 8: Commit**

```bash
git add src/core/state/state.ts src/core/state/state.types.ts src/core/state/index.ts test/state-session-keys.test.ts
git commit -m "feat(state): derive a session key and its per-session paths"
```

---

### Task 2: The three-state flag

**Files:**
- Modify: `src/core/state/state.ts`
- Modify: `src/core/state/index.ts`
- Test: `test/state-session-keys.test.ts`

**Interfaces:**
- Consumes: `sessionKey`, `sessionKeyFlagPath`, `sessionKeyOptOutPath` from Task 1.
- Produces:
  - `isEnabled(filePath: string, key?: SessionKey): boolean` — the existing signature gains an optional second parameter
  - `enableSession(key: SessionKey): string` — writes the session flag, removes any opt-out, returns the flag path
  - `optOutSession(key: SessionKey): string` — writes the opt-out, removes any session flag, returns the opt-out path
  - `sessionFlagState(key: SessionKey): FlagState`

- [ ] **Step 1: Write the failing test**

Append to `test/state-session-keys.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/state-session-keys.test.ts`

Expected: FAIL. The error names `enableSession` as not exported.

- [ ] **Step 3: Implement the flag functions**

In `src/core/state/state.ts`, add `FlagState` to the type import:

```ts
import type { SessionKey, FlagState } from "./state.types";
```

Replace the existing `isEnabled` with the version below, and add the three helpers after it:

```ts
export function sessionFlagState(key: SessionKey): FlagState {
  if (existsSync(sessionKeyOptOutPath(key))) {
    return "off";
  }

  return existsSync(sessionKeyFlagPath(key)) ? "on" : "unset";
}

function directoryEnabled(filePath: string): boolean {
  let current = dirname(realpathLenient(filePath));

  while (true) {
    if (existsSync(flagPath(current))) {
      return true;
    }

    const parent = dirname(current);

    if (parent === current) {
      return false;
    }

    current = parent;
  }
}

// A session opt-out beats a directory flag, so one session goes quiet without silencing its neighbours.
export function isEnabled(filePath: string, key?: SessionKey): boolean {
  if (key !== undefined) {
    const state = sessionFlagState(key);

    if (state !== "unset") {
      return state === "on";
    }
  }

  return directoryEnabled(filePath);
}

export function enableSession(key: SessionKey): string {
  const path = sessionKeyFlagPath(key);
  mkdirSync(dirname(path), { recursive: true });
  removeQuietly(sessionKeyOptOutPath(key));
  writeFileSync(path, "");
  return path;
}

export function optOutSession(key: SessionKey): string {
  const path = sessionKeyOptOutPath(key);
  mkdirSync(dirname(path), { recursive: true });
  removeQuietly(sessionKeyFlagPath(key));
  writeFileSync(path, "");
  return path;
}
```

Add the `removeQuietly` import at the top of `src/core/state/state.ts`:

```ts
import { removeQuietly } from "../../helpers";
```

- [ ] **Step 4: Export the new functions**

In `src/core/state/index.ts`, add `enableSession`, `optOutSession`, and `sessionFlagState` to the export list from `./state`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/state-session-keys.test.ts`

Expected: PASS, 14 tests.

- [ ] **Step 6: Run the full gates**

Run: `npx vitest run && npx tsc --noEmit && npx oxlint && npx oxfmt --check`

Expected: all pass. `test/state.test.ts` still passes untouched, because `isEnabled` with no key keeps its behaviour.

- [ ] **Step 7: Commit**

```bash
git add src/core/state/state.ts src/core/state/index.ts test/state-session-keys.test.ts
git commit -m "feat(state): let a session opt out of a directory flag"
```

---

### Task 3: The socket resolution chain

**Files:**
- Modify: `src/core/state/state.ts`
- Modify: `src/core/state/index.ts`
- Test: `test/state-session-keys.test.ts`

**Interfaces:**
- Consumes: `sessionKeySocketPath` from Task 1, `findSessionSocket` from the existing module.
- Produces:
  - `resolveSocketPath(filePath: string, key?: SessionKey): string | null`

- [ ] **Step 1: Write the failing test**

Append to `test/state-session-keys.test.ts`:

```ts
import { resolveSocketPath, sessionsDir } from "../src/core/state";

describe("resolveSocketPath", () => {
  const agentId = "d95655de-eb7f-45e5-867d-9797a355353e";

  function touch(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "", "utf-8");
  }

  function fileIn(directory: string): string {
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "main.ts");
    writeFileSync(path, "", "utf-8");
    return path;
  }

  test("prefers the session socket when it exists", () => {
    const key = sessionKey(agentId);
    const socket = sessionKeySocketPath(key);
    touch(socket);

    const directory = join(process.env["XDG_STATE_HOME"] ?? "", "chain1");
    const path = fileIn(directory);
    touch(sessionSocketPath(directory));

    expect(resolveSocketPath(path, key)).toBe(socket);
  });

  test("falls to the directory socket when the session has none", () => {
    const directory = join(process.env["XDG_STATE_HOME"] ?? "", "chain2");
    const path = fileIn(directory);
    const socket = sessionSocketPath(directory);
    touch(socket);

    expect(resolveSocketPath(path, sessionKey(agentId))).toBe(socket);
  });

  test("finds a directory socket at an ancestor of the edited file", () => {
    const root = join(process.env["XDG_STATE_HOME"] ?? "", "chain3");
    const nested = join(root, "src", "deep");
    const path = fileIn(nested);
    const socket = sessionSocketPath(root);
    touch(socket);

    expect(resolveSocketPath(path, sessionKey(agentId))).toBe(socket);
  });

  test("returns null when neither tier has a socket", () => {
    const directory = join(process.env["XDG_STATE_HOME"] ?? "", "chain4");
    const path = fileIn(directory);

    expect(resolveSocketPath(path, sessionKey(agentId))).toBeNull();
  });

  test("with no key it resolves the directory tier only", () => {
    const directory = join(process.env["XDG_STATE_HOME"] ?? "", "chain5");
    const path = fileIn(directory);
    touch(sessionKeySocketPath(sessionKey(agentId)));

    expect(resolveSocketPath(path)).toBeNull();

    const socket = sessionSocketPath(directory);
    touch(socket);

    expect(resolveSocketPath(path)).toBe(socket);
  });
});
```

Add `dirname` and `sessionSocketPath` to the imports at the top of the test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/state-session-keys.test.ts`

Expected: FAIL. The error names `resolveSocketPath` as not exported.

- [ ] **Step 3: Implement the chain**

Add to `src/core/state/state.ts`, after `findSessionSocket`:

```ts
// The session socket wins, then a directory socket found by walking up. Neither one means the hook fails open.
export function resolveSocketPath(filePath: string, key?: SessionKey): string | null {
  if (key !== undefined) {
    const candidate = sessionKeySocketPath(key);

    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return findSessionSocket(filePath);
}
```

- [ ] **Step 4: Export it**

Add `resolveSocketPath` to the export list in `src/core/state/index.ts`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/state-session-keys.test.ts`

Expected: PASS, 19 tests.

- [ ] **Step 6: Run the full gates**

Run: `npx vitest run && npx tsc --noEmit && npx oxlint && npx oxfmt --check`

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/state/state.ts src/core/state/index.ts test/state-session-keys.test.ts
git commit -m "feat(state): resolve a socket by session, then by directory"
```

---

### Task 4: Thread the session id from the payload to the transport

**Files:**
- Modify: `src/transports/transport.types.ts`
- Modify: `src/core/simulate/simulate.ts`
- Modify: `src/core/run/run.ts`
- Modify: `src/transports/session/client.ts`
- Modify: `src/adapters/claude-code/claude-code.ts`
- Modify: `src/adapters/codex/codex.ts`
- Test: `test/session-client.test.ts`

**Interfaces:**
- Consumes: `isEnabled(filePath, key?)` from Task 2, `resolveSocketPath(filePath, key?)` from Task 3, `sessionKey` from Task 1.
- Produces:
  - `EditRequest` gains `sessionId?: string`
  - `simulate(tool, toolInput, read, sessionId?)` — the existing signature gains an optional fourth parameter

- [ ] **Step 1: Write the failing test**

Append to `test/session-client.test.ts`:

```ts
describe("the resolution chain in the client", () => {
  test("a request with a session id reaches the session socket, not the directory socket", async () => {
    const key = sessionKey("d95655de-eb7f-45e5-867d-9797a355353e");
    const sessionSocket = sessionKeySocketPath(key);

    mkdirSync(dirname(sessionSocket), { recursive: true });

    const server = await startSessionServer({ socketPath: sessionSocket });
    const seen: string[] = [];

    const client = await connectClient(sessionSocket);
    client.write(encode({ type: "attach", client: "tui" }));

    await onReview(client, (review) => {
      seen.push(review.path);
      client.write(encode({ type: "verdict", id: review.id, questions: [] }));
    });

    const directory = isolated.tempDir("pair-chain-");
    const filePath = join(directory, "main.ts");
    writeFileSync(filePath, "before\n", "utf-8");

    const transport = createSessionTransport();

    const outcome = await transport.review(
      { tool: "Write", filePath, before: "before\n", after: "after\n", sessionId: "d95655de-eb7f-45e5-867d-9797a355353e" },
      DEFAULT_CONFIG,
    );

    expect(outcome.reviewed).toBe(true);
    expect(seen).toEqual([filePath]);

    client.destroy();
    await server.close();
  });

  test("a request with no session id still resolves the directory socket", async () => {
    const directory = isolated.tempDir("pair-chain-dir-");
    const socketPath = sessionSocketPath(directory);

    mkdirSync(dirname(socketPath), { recursive: true });

    const server = await startSessionServer({ socketPath });
    const client = await connectClient(socketPath);
    client.write(encode({ type: "attach", client: "tui" }));

    await onReview(client, (review) => {
      client.write(encode({ type: "verdict", id: review.id, questions: [] }));
    });

    const filePath = join(directory, "main.ts");
    writeFileSync(filePath, "before\n", "utf-8");

    const transport = createSessionTransport();

    const outcome = await transport.review(
      { tool: "Write", filePath, before: "before\n", after: "after\n" },
      DEFAULT_CONFIG,
    );

    expect(outcome.reviewed).toBe(true);

    client.destroy();
    await server.close();
  });
});
```

Reuse whatever `connectClient` and `onReview` helpers `test/session-client.test.ts` already defines. Read the top of that file first and match its existing style rather than inventing new helpers.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/session-client.test.ts`

Expected: FAIL. TypeScript rejects `sessionId` as an unknown property on `EditRequest`.

- [ ] **Step 3: Add the field to EditRequest**

In `src/transports/transport.types.ts`, replace the `EditRequest` interface with:

```ts
export interface EditRequest {
  tool: string;
  filePath: string;
  before: string;
  after: string;
  sessionId?: string;
}
```

- [ ] **Step 4: Use the chain in the client**

In `src/transports/session/client.ts`, replace the `findSessionSocket` import with:

```ts
import { resolveSocketPath, sessionKey } from "../../core/state";
```

Then replace `reviewInSession` with:

```ts
function reviewInSession(
  request: EditRequest,
  config: PairConfig,
  socketPath?: string,
): Promise<ReviewOutcome> {
  const key = request.sessionId === undefined ? undefined : sessionKey(request.sessionId);
  const path = socketPath ?? resolveSocketPath(request.filePath, key);

  if (path === null) {
    return Promise.resolve(failOpen("no pair-mode watcher attached"));
  }

  return requestReview(request, {
    socketPath: path,
    timeoutMs: config.session.timeout * MS_PER_SECOND,
  });
}
```

- [ ] **Step 5: Carry the session id through simulate**

In `src/core/simulate/simulate.ts`, replace the exported `simulate` function with:

```ts
export function simulate(
  tool: string,
  input: unknown,
  readFile: (path: string) => string,
  sessionId?: string,
): EditRequest | null {
  if (!isRecord(input)) {
    return null;
  }

  const filePath = getFilePath(input);

  if (filePath === null) {
    return null;
  }

  if (tool === "Write") {
    const content = input["content"];
    const after = typeof content === "string" ? content : "";
    const before = readFile(filePath);

    return { tool, filePath, before, after, sessionId };
  }

  if (tool === "Edit" || tool === "MultiEdit") {
    const editsRaw = input["edits"];
    const edits = Array.isArray(editsRaw) ? editsRaw : [input];
    const before = readFile(filePath);

    const after = edits.reduce<string | null>((current, rawEdit) => {
      if (current === null || !isEditItem(rawEdit)) {
        return null;
      }

      return applyEdit(current, rawEdit);
    }, before);

    if (after === null) {
      return null;
    }

    return { tool, filePath, before, after, sessionId };
  }

  return null;
}
```

- [ ] **Step 6: Use the key in runPair**

In `src/core/run/run.ts`, add the import:

```ts
import { isEnabled, sessionKey } from "../state";
```

Then replace the enabled check:

```ts
  const key = request.sessionId === undefined ? undefined : sessionKey(request.sessionId);

  if (!isEnabled(request.filePath, key)) {
    return { decision: "allow", reviewed: false };
  }
```

- [ ] **Step 7: Read session_id in the Claude Code adapter**

In `src/adapters/claude-code/claude-code.ts`, inside `main`, after the `toolInput` guard, add:

```ts
  const rawSessionId = payload["session_id"];
  const sessionId = typeof rawSessionId === "string" ? rawSessionId : undefined;
```

Then replace the `isEnabled` call and the `simulate` call:

```ts
  const key = sessionId === undefined ? undefined : sessionKey(sessionId);

  if (!isEnabled(filePath, key)) {
    return 0;
  }

  const request = simulate(tool, toolInput, readFileOrEmpty, sessionId);
```

Add `sessionKey` to the state import at the top of the file.

- [ ] **Step 8: Do the same in the Codex adapter**

`src/adapters/codex/codex.ts` reads the same `session_id` field, because Codex sends the identical key. Apply the same three changes: read `session_id`, derive the key, pass both to `isEnabled` and `simulate`. Read the file first, because its `simulate` call site differs from the Claude Code one.

- [ ] **Step 9: Fall to the directory tier when a session socket is stale**

A crashed watcher leaves its socket file behind. `resolveSocketPath` only checks that the
file exists, so the hook would post to a dead socket and fail open on every edit.

Add the retry to `src/transports/session/client.ts`. Replace `reviewInSession` again with:

```ts
async function reviewInSession(
  request: EditRequest,
  config: PairConfig,
  socketPath?: string,
): Promise<ReviewOutcome> {
  const timeoutMs = config.session.timeout * MS_PER_SECOND;

  if (socketPath !== undefined) {
    return await requestReview(request, { socketPath, timeoutMs });
  }

  const key = request.sessionId === undefined ? undefined : sessionKey(request.sessionId);
  const sessionPath = key === undefined ? null : sessionKeySocketPath(key);

  if (sessionPath !== null && existsSync(sessionPath)) {
    const outcome = await requestReview(request, { socketPath: sessionPath, timeoutMs });

    if (outcome.reviewed) {
      return outcome;
    }

    // A refused session socket outlived its watcher, so it goes and the directory tier gets a turn.
    if (outcome.detail === NO_WATCHER) {
      removeQuietly(sessionPath);
    } else {
      return outcome;
    }
  }

  const directoryPath = findSessionSocket(request.filePath);

  if (directoryPath === null) {
    return failOpen(NO_WATCHER);
  }

  return await requestReview(request, { socketPath: directoryPath, timeoutMs });
}
```

Add the constant beside `MS_PER_SECOND`:

```ts
const NO_WATCHER = "no pair-mode watcher attached";
```

Replace the two literal occurrences of that string in `requestReview` with `NO_WATCHER`.

Update the imports at the top of the file:

```ts
import { existsSync } from "node:fs";
import { findSessionSocket, sessionKey, sessionKeySocketPath } from "../../core/state";
import { removeQuietly } from "../../helpers";
```

`resolveSocketPath` from Task 3 stays exported. `pair-mode doctor` and the sessions listing
both use it, and its `existsSync` check is correct for their read-only purpose.

- [ ] **Step 10: Test the stale fallback**

Append to `test/session-client.test.ts`:

```ts
test("a stale session socket is removed and the directory socket answers", async () => {
  const key = sessionKey("d95655de-eb7f-45e5-867d-9797a355353e");
  const stale = sessionKeySocketPath(key);

  mkdirSync(dirname(stale), { recursive: true });
  writeFileSync(stale, "", "utf-8");

  const directory = isolated.tempDir("pair-stale-");
  const socketPath = sessionSocketPath(directory);
  const server = await startSessionServer({ socketPath });

  const client = await connectClient(socketPath);
  client.write(encode({ type: "attach", client: "tui" }));

  await onReview(client, (review) => {
    client.write(encode({ type: "verdict", id: review.id, questions: [] }));
  });

  const filePath = join(directory, "main.ts");
  writeFileSync(filePath, "before\n", "utf-8");

  const outcome = await createSessionTransport().review(
    {
      tool: "Write",
      filePath,
      before: "before\n",
      after: "after\n",
      sessionId: "d95655de-eb7f-45e5-867d-9797a355353e",
    },
    DEFAULT_CONFIG,
  );

  expect(outcome.reviewed).toBe(true);
  expect(existsSync(stale)).toBe(false);

  client.destroy();
  await server.close();
});
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `npx vitest run test/session-client.test.ts`

Expected: PASS. The existing tests in that file still pass, because `sessionId` is optional.

- [ ] **Step 12: Run the full gates**

Run: `npx vitest run && npx tsc --noEmit && npx oxlint && npx oxfmt --check`

Expected: all pass.

- [ ] **Step 13: Commit**

```bash
git add src/transports/transport.types.ts src/transports/session/client.ts src/core/simulate/simulate.ts src/core/run/run.ts src/adapters test/session-client.test.ts
git commit -m "feat(hook): resolve a socket from the payload session id"
```

---

### Task 5: Session-scoped on, off, toggle, and status

**Files:**
- Modify: `src/cli/toggle.ts`
- Modify: `src/cli/toggle.types.ts`
- Test: `test/cli-toggle.test.ts`

**Interfaces:**
- Consumes: `enableSession`, `optOutSession`, `sessionFlagState`, `sessionKey`, `isEnabled` from Tasks 1 and 2.
- Produces:
  - `agentSessionId(env: NodeJS.ProcessEnv): string | null` — reads `CLAUDE_CODE_SESSION_ID`, then `CODEX_SESSION_ID`, then `CODEX_THREAD_ID`
  - `pairOn(directory: string, key?: SessionKey): string`
  - `pairOff(directory: string, key?: SessionKey): string`
  - `pairStatus(directory: string, key?: SessionKey): string`
  - `pairToggle(directory: string, cliPath: string, web: boolean, key?: SessionKey): Promise<string>`

- [ ] **Step 1: Write the failing test**

Append to `test/cli-toggle.test.ts`:

```ts
describe("session-scoped toggling", () => {
  const agentId = "d95655de-eb7f-45e5-867d-9797a355353e";

  test("agentSessionId reads the Claude Code variable", () => {
    expect(agentSessionId({ CLAUDE_CODE_SESSION_ID: agentId })).toBe(agentId);
  });

  test("agentSessionId falls back to the Codex variables", () => {
    expect(agentSessionId({ CODEX_SESSION_ID: agentId })).toBe(agentId);
    expect(agentSessionId({ CODEX_THREAD_ID: agentId })).toBe(agentId);
  });

  test("agentSessionId returns null in a plain terminal", () => {
    expect(agentSessionId({})).toBeNull();
  });

  test("on with a key writes the session flag, not the directory flag", () => {
    const directory = isolated.tempDir("pair-scope-");
    const key = sessionKey(agentId);

    pairOn(directory, key);

    expect(sessionFlagState(key)).toBe("on");
    expect(existsSync(flagPath(directory))).toBe(false);
  });

  test("a bare off writes the session opt-out and spares the directory flag", () => {
    const directory = isolated.tempDir("pair-scope-off-");
    const key = sessionKey(agentId);

    enable(directory);
    pairOff(directory, key);

    expect(sessionFlagState(key)).toBe("off");
    expect(existsSync(flagPath(directory))).toBe(true);
  });

  test("off with no key clears the directory flag", () => {
    const directory = isolated.tempDir("pair-scope-dir-off-");

    enable(directory);
    pairOff(directory);

    expect(existsSync(flagPath(directory))).toBe(false);
  });

  test("toggle with a key flips the session tier only", async () => {
    const directory = isolated.tempDir("pair-scope-toggle-");
    const key = sessionKey(agentId);

    await pairToggle(directory, "", false, key);
    expect(sessionFlagState(key)).toBe("on");

    await pairToggle(directory, "", false, key);
    expect(sessionFlagState(key)).toBe("off");
  });

  test("status with a key reports the resolved state and names the key", () => {
    const directory = isolated.tempDir("pair-scope-status-");
    const key = sessionKey(agentId);

    pairOn(directory, key);

    const text = pairStatus(directory, key);

    expect(text).toContain("ON");
    expect(text).toContain(key);
  });
});
```

Add the needed imports to the top of `test/cli-toggle.test.ts`: `agentSessionId`, `sessionKey`, `sessionFlagState`, `enable`, `flagPath`, and `existsSync`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/cli-toggle.test.ts`

Expected: FAIL. The error names `agentSessionId` as not exported.

- [ ] **Step 3: Implement the environment reader**

In `src/cli/toggle.ts`, add near the top:

```ts
const SESSION_ENV_VARS = ["CLAUDE_CODE_SESSION_ID", "CODEX_SESSION_ID", "CODEX_THREAD_ID"];

// Only `pair-mode on` reads the environment, because it receives no hook payload to read instead.
export function agentSessionId(env: NodeJS.ProcessEnv): string | null {
  for (const name of SESSION_ENV_VARS) {
    const value = env[name];

    if (typeof value === "string" && value !== "") {
      return value;
    }
  }

  return null;
}
```

- [ ] **Step 4: Make the four commands key-aware**

Replace `pairOn`, `pairOff`, `pairToggle`, and `pairStatus` in `src/cli/toggle.ts` with:

```ts
export function pairOn(directory: string, key?: SessionKey): string {
  if (key !== undefined) {
    enableSession(key);
    return `pair mode ON · ${key} · ${directory}`;
  }

  enable(directory);
  return `pair mode ON for ${directory}`;
}

export function pairOff(directory: string, key?: SessionKey): string {
  if (key !== undefined) {
    optOutSession(key);
    return `pair mode OFF · ${key}`;
  }

  disable(directory);
  const stopped = stopLink(directory);

  return stopped
    ? `pair mode OFF for ${directory} (web watcher stopped)`
    : `pair mode OFF for ${directory}`;
}

// A toggle reads the resolved state itself, so the caller needs no status check and no argument.
export async function pairToggle(
  directory: string,
  cliPath: string,
  web: boolean,
  key?: SessionKey,
): Promise<string> {
  const on =
    key === undefined ? existsSync(flagPath(directory)) : sessionFlagState(key) === "on";

  if (on) {
    return pairOff(directory, key);
  }

  if (web) {
    return await pairOnWeb(directory, cliPath);
  }

  return pairOn(directory, key);
}

export function pairStatus(directory: string, key?: SessionKey): string {
  const probe = join(directory, ".pair-mode-status-probe");
  const on = isEnabled(probe, key);
  const link = readLink(directory);
  const scope = key === undefined ? directory : `${key} · ${directory}`;
  const state = `pair mode ${on ? "ON" : "OFF"} for ${scope}`;

  return link === null ? state : `${state}\n${link.url}`;
}
```

Add these imports to the top of `src/cli/toggle.ts`:

```ts
import { join } from "node:path";
import {
  enable,
  disable,
  flagPath,
  sessionUrlPath,
  enableSession,
  optOutSession,
  sessionFlagState,
  isEnabled,
} from "../core/state";
import type { SessionKey } from "../core/state";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/cli-toggle.test.ts`

Expected: PASS. The existing tests in that file still pass, because every new parameter is optional.

- [ ] **Step 6: Run the full gates**

Run: `npx vitest run && npx tsc --noEmit && npx oxlint && npx oxfmt --check`

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/cli/toggle.ts src/cli/toggle.types.ts test/cli-toggle.test.ts
git commit -m "feat(cli): scope on, off, toggle, and status to the agent session"
```

---

### Task 6: Bind a watcher to a session key

**Files:**
- Modify: `src/cli/watch/watch.ts`
- Modify: `src/cli/watch/watch.types.ts`
- Modify: `src/web/watch.ts`
- Modify: `src/web/watch.types.ts`
- Modify: `src/cli/index.ts`
- Test: `test/cli-watch.test.ts`

**Interfaces:**
- Consumes: `sessionKeySocketPath` from Task 1, `agentSessionId` and the key-aware commands from Task 5.
- Produces:
  - `WatchOptions` gains `sessionKey?: SessionKey`
  - `WebWatchOptions` gains `sessionKey?: SessionKey`
  - `pair-mode watch <id>` binds `sessionKeySocketPath(<id>)`

- [ ] **Step 1: Write the failing test**

Append to `test/cli-watch.test.ts`:

```ts
describe("watching one session", () => {
  test("a session key decides the socket path", async () => {
    const key = sessionKey("d95655de-eb7f-45e5-867d-9797a355353e");
    const directory = isolated.tempDir("pair-watch-key-");

    const io = fakeIo();
    const run = runWatch({ directory, sessionKey: key, io }, DEFAULT_CONFIG);

    await settle();

    expect(existsSync(sessionKeySocketPath(key))).toBe(true);
    expect(existsSync(sessionSocketPath(directory))).toBe(false);

    io.pressKey("q");
    await run;
  });
});
```

Reuse the `fakeIo` and `settle` helpers that `test/cli-watch.test.ts` already defines. Read the top of that file first and match its existing style.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/cli-watch.test.ts`

Expected: FAIL. TypeScript rejects `sessionKey` as an unknown property on `WatchOptions`.

- [ ] **Step 3: Add the option to both watchers**

In `src/cli/watch/watch.types.ts`, add to `WatchOptions`:

```ts
  sessionKey?: SessionKey;
```

Import the type: `import type { SessionKey } from "../../core/state";`

In `src/cli/watch/watch.ts`, replace the socket path line:

```ts
  const socketPath =
    options.socketPath ??
    (options.sessionKey === undefined
      ? sessionSocketPath(options.directory)
      : sessionKeySocketPath(options.sessionKey));
```

Add `sessionKeySocketPath` to the state import.

Apply the identical change to `src/web/watch.ts` and `src/web/watch.types.ts`.

- [ ] **Step 4: Dispatch watch with an id**

In `src/cli/index.ts`, add this helper below `parseDirectoryArgs`:

```ts
const SESSION_KEY_PATTERN = /^s-[0-9a-f]{8}$/;

// A `watch` argument is either a session key or a directory, and only one of them starts with `s-`.
function parseWatchArgs(args: string[]) {
  const flags = args.filter(isFlag);
  const target = args.find((entry) => !isFlag(entry));
  const isKey = target !== undefined && SESSION_KEY_PATTERN.test(target);

  return {
    sessionKey: isKey ? target : undefined,
    directory: isKey ? process.cwd() : resolve(target ?? process.cwd()),
    web: flags.includes("--web"),
    unknownFlag: flags.find((flag) => flag !== "--web") ?? null,
  };
}
```

In the `watch` branch, replace `parseDirectoryArgs(process.argv.slice(3), ["--web"])` with
`parseWatchArgs(process.argv.slice(3))`. Then add this check directly after the unknown-flag
guard:

```ts
    if (parsed.sessionKey !== undefined && !existsSync(sessionKeySocketPath(parsed.sessionKey))) {
      console.error(`unknown session: ${parsed.sessionKey}`);
      console.error("run pair-mode sessions to list the live ones");
      return 1;
    }
```

Pass `sessionKey: parsed.sessionKey` into both `runWatch` and `startWebWatch`.

Add `existsSync` from `node:fs` and `sessionKeySocketPath` from `../core/state` to the imports.

Add to `USAGE`, directly after the `watch --web [dir]` line:

```
  watch <id>           review edits for one session (see: pair-mode sessions)
```

- [ ] **Step 5: Verify the unknown-id guard by hand**

The guard lives in `src/cli/index.ts`, and no test file drives that dispatch today. Verify it
by running the built CLI:

```bash
pnpm run build
node dist/cli.js watch s-deadbeef
echo "exit=$?"
```

Expected: stderr reads `unknown session: s-deadbeef`, then
`run pair-mode sessions to list the live ones`. The exit code is 1.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/cli-watch.test.ts`

Expected: PASS.

- [ ] **Step 7: Run the full gates**

Run: `npx vitest run && npx tsc --noEmit && npx oxlint && npx oxfmt --check`

Expected: all pass. `test/cli-toggle.test.ts:177` asserts on USAGE content, so confirm it still passes with the added line.

- [ ] **Step 8: Commit**

```bash
git add src/cli/watch src/web/watch.ts src/web/watch.types.ts src/cli/index.ts test/cli-watch.test.ts
git commit -m "feat(cli): bind a watcher to one session key"
```

---

### Task 7: Wire the toggle commands to the environment, then open PR 1

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Test: `test/cli-toggle.test.ts`

**Interfaces:**
- Consumes: `agentSessionId` from Task 5.
- Produces: no new exports.

- [ ] **Step 1: Wire the four commands**

In `src/cli/index.ts`, add near the other imports:

```ts
import { agentSessionId } from "./toggle";
import { sessionKey } from "../core/state";
```

Then add this helper below `parseDirectoryArgs`:

```ts
// An agent session keys its own socket. A plain terminal has no session id and keeps the directory scope.
function currentSessionKey(): string | undefined {
  const id = agentSessionId(process.env);
  return id === null ? undefined : sessionKey(id);
}
```

Pass `currentSessionKey()` as the trailing argument to `pairOn`, `pairOff`, `pairStatus`, and `pairToggle` in their dispatch branches.

- [ ] **Step 2: Verify by hand**

Run:

```bash
pnpm run build
CLAUDE_CODE_SESSION_ID=test-session-abc node dist/cli.js status /tmp
CLAUDE_CODE_SESSION_ID=test-session-abc node dist/cli.js on /tmp
CLAUDE_CODE_SESSION_ID=test-session-abc node dist/cli.js status /tmp
node dist/cli.js status /tmp
CLAUDE_CODE_SESSION_ID=test-session-abc node dist/cli.js off /tmp
```

Expected: the first `status` reports OFF. The `on` prints a line naming an `s-` key. The second `status` reports ON and names the same key. The bare `status` reports OFF, because a plain terminal reads the directory tier. The `off` reports OFF and names the key.

Then clean up: `rm -f "${XDG_STATE_HOME:-$HOME/.local/state}"/pair-mode/sessions/s-*`

- [ ] **Step 3: Update the README**

In `README.md`, add a subsection under `## Session modes`, before `### Session mode config`:

```markdown
### One socket per agent session

`pair-mode on` inside an agent session reads that session's id and mints a socket for it
alone. It prints the socket id. Another session in the same checkout gets its own socket
and never sees the first session's diffs.

`pair-mode on <dir>` from a plain terminal keeps the old behaviour. It writes a directory
flag, and its socket catches every session that has no socket of its own.

A bare `pair-mode off` inside a session turns pair mode off for that session only. It never
clears a directory flag, so it never silences another session. `pair-mode off <dir>` names
its target and clears the directory flag.
```

- [ ] **Step 4: Update the changelog**

Add under `## [Unreleased]` in `CHANGELOG.md`:

```markdown
### Added

- Each agent coding session gets its own review socket, so concurrent sessions in one repository stop sharing diffs.
- A session can opt out of a directory flag, and the opt-out never silences another session.

### Changed

- The hook resolves a socket by session id first, then by walking up for a directory socket.
```

- [ ] **Step 5: Run the full gates**

Run: `npx vitest run && npx tsc --noEmit && npx oxlint && npx oxfmt --check && pnpm run build`

Expected: all pass.

- [ ] **Step 6: Commit and open the PR**

```bash
git add src/cli/index.ts README.md CHANGELOG.md
git commit -m "feat(cli): read the agent session id from the environment"
git push -u origin feat/session-keyed-sockets/pm-16
```

Then open the pull request against `main`. Write the body as **What**, **How**, **Why**, and keep it succinct. Do not merge it.

---

# PR 2 — Broadcast dispatch

Branch: `feat/broadcast-reviews/pm-17`

Create it after PR 1 merges.

```bash
git checkout main
git pull
git checkout -b feat/broadcast-reviews/pm-17
```

---

### Task 8: Replace the single-holder queue with a broadcast set

**Files:**
- Modify: `src/transports/session/queue.ts`
- Modify: `src/transports/session/queue.types.ts`
- Modify: `src/transports/session/index.ts`
- Test: `test/session-queue.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ReviewStatus` becomes `"waiting" | "offered"`
  - `offerAll(state: QueueState): { state: QueueState; reviews: QueuedReview[] }` — marks every waiting review offered and returns them
  - `takeNext` is removed
  - `release(state, id)` keeps its signature and returns an offered review to waiting

- [ ] **Step 1: Write the failing test**

Replace the `takeNext` describe block in `test/session-queue.test.ts` with:

```ts
describe("offerAll", () => {
  test("marks every waiting review offered and returns them in order", () => {
    let state = emptyQueue();
    state = enqueue(state, "a", request("a.ts"));
    state = enqueue(state, "b", request("b.ts"));

    const result = offerAll(state);

    expect(result.reviews.map((review) => review.id)).toEqual(["a", "b"]);
    expect(result.state.reviews.every((review) => review.status === "offered")).toBe(true);
  });

  test("returns nothing when every review is already offered", () => {
    let state = emptyQueue();
    state = enqueue(state, "a", request("a.ts"));

    const first = offerAll(state);
    const second = offerAll(first.state);

    expect(second.reviews).toEqual([]);
    expect(second.state).toEqual(first.state);
  });

  test("leaves the input state untouched", () => {
    let state = emptyQueue();
    state = enqueue(state, "a", request("a.ts"));

    offerAll(state);

    expect(state.reviews[0]?.status).toBe("waiting");
  });

  test("waitingDepth counts only reviews nobody has been offered", () => {
    let state = emptyQueue();
    state = enqueue(state, "a", request("a.ts"));
    state = enqueue(state, "b", request("b.ts"));

    expect(waitingDepth(state)).toBe(2);

    const offered = offerAll(state);

    expect(waitingDepth(offered.state)).toBe(0);
  });

  test("release returns an offered review to waiting", () => {
    let state = emptyQueue();
    state = enqueue(state, "a", request("a.ts"));

    const offered = offerAll(state);
    const released = release(offered.state, "a");

    expect(released.reviews[0]?.status).toBe("waiting");
  });
});
```

Reuse the `request` helper that `test/session-queue.test.ts` already defines.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/session-queue.test.ts`

Expected: FAIL. The error names `offerAll` as not exported.

- [ ] **Step 3: Change the status type**

In `src/transports/session/queue.types.ts`, replace the status type:

```ts
export type ReviewStatus = "waiting" | "offered";
```

Delete the `TakeResult` interface and add:

```ts
export interface OfferResult {
  state: QueueState;
  reviews: QueuedReview[];
}
```

- [ ] **Step 4: Implement offerAll and delete takeNext**

In `src/transports/session/queue.ts`, delete `takeNext` and add:

```ts
// Every attached client sees every review, so the queue offers them all at once rather than handing one to one client.
export function offerAll(state: QueueState): OfferResult {
  const waiting = state.reviews.filter((review) => review.status === "waiting");

  if (waiting.length === 0) {
    return { state, reviews: [] };
  }

  const offered = waiting.map((review): QueuedReview => ({ ...review, status: "offered" }));
  const byId = new Map(offered.map((review) => [review.id, review]));

  const reviews = state.reviews.map((review) => byId.get(review.id) ?? review);

  return { state: { reviews }, reviews: offered };
}
```

Update the imports in that file to take `OfferResult` instead of `TakeResult`.

- [ ] **Step 5: Update the module exports**

In `src/transports/session/index.ts`, replace `takeNext` with `offerAll` in the value export list, and replace `TakeResult` with `OfferResult` in the type export list.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/session-queue.test.ts`

Expected: PASS.

- [ ] **Step 7: Verify the expected breakage**

Run: `npx tsc --noEmit`

Expected: FAIL, and only in `src/transports/session/server.ts`, which still calls `takeNext`. Task 9 fixes it. Do not commit yet.

---

### Task 9: Broadcast in the server, first verdict wins

**Files:**
- Modify: `src/transports/session/server.ts`
- Test: `test/session-server.test.ts`
- Test: `test/session-broadcast.test.ts`

**Interfaces:**
- Consumes: `offerAll` and `release` from Task 8.
- Produces: no new exports. `dispatch` broadcasts, and `handleVerdict` cancels every other holder.

- [ ] **Step 1: Rewrite the work-stealing test**

In `test/session-server.test.ts`, find the test at roughly line 194 named "two attached clients each take one of two queued reviews". Replace it with:

```ts
test("two attached clients each receive both queued reviews", async () => {
  const socketPath = join(isolated.tempDir("pair-sess-"), "s.sock");
  const server = await startSessionServer({ socketPath });

  const first = await connectClient(socketPath);
  const second = await connectClient(socketPath);

  const seenByFirst: string[] = [];
  const seenBySecond: string[] = [];

  collectReviews(first, seenByFirst);
  collectReviews(second, seenBySecond);

  first.write(encode({ type: "attach", client: "tui" }));
  second.write(encode({ type: "attach", client: "web" }));

  await submit(socketPath, "a.ts");
  await submit(socketPath, "b.ts");
  await settle();

  expect(seenByFirst).toHaveLength(2);
  expect(seenBySecond).toHaveLength(2);
  expect(seenByFirst).toEqual(seenBySecond);

  first.destroy();
  second.destroy();
  await server.close();
});
```

Reuse the helpers that file already defines. Read its top before writing, and add `collectReviews` alongside the existing helpers if it does not already exist.

- [ ] **Step 2: Write the new broadcast test file**

Create `test/session-broadcast.test.ts`:

```ts
import { join } from "node:path";
import { test, expect, describe } from "vitest";
import { useIsolatedHome } from "./helpers/env";
import { startSessionServer, encode, decodeLine, createLineReader } from "../src/transports/session";

const isolated = useIsolatedHome();

describe("broadcast dispatch", () => {
  test("the first verdict completes the review and the other client hears cancel", async () => {
    const socketPath = join(isolated.tempDir("pair-bcast-"), "s.sock");
    const server = await startSessionServer({ socketPath });

    const first = await connectClient(socketPath);
    const second = await connectClient(socketPath);

    const cancelled: string[] = [];
    let reviewId = "";

    onMessage(first, (message) => {
      if (message.type === "review") {
        reviewId = message.id;
      }
    });

    onMessage(second, (message) => {
      if (message.type === "cancel") {
        cancelled.push(message.id);
      }
    });

    first.write(encode({ type: "attach", client: "tui" }));
    second.write(encode({ type: "attach", client: "web" }));

    const verdict = await submitAndAwaitVerdict(socketPath, "a.ts", () => {
      first.write(encode({ type: "verdict", id: reviewId, questions: [] }));
    });

    expect(verdict.questions).toEqual([]);
    expect(cancelled).toEqual([reviewId]);
    expect(server.waitingDepth()).toBe(0);

    first.destroy();
    second.destroy();
    await server.close();
  });

  test("the server never waits for a second verdict", async () => {
    const socketPath = join(isolated.tempDir("pair-bcast2-"), "s.sock");
    const server = await startSessionServer({ socketPath });

    const answering = await connectClient(socketPath);
    const silent = await connectClient(socketPath);

    let reviewId = "";

    onMessage(answering, (message) => {
      if (message.type === "review") {
        reviewId = message.id;
      }
    });

    answering.write(encode({ type: "attach", client: "tui" }));
    silent.write(encode({ type: "attach", client: "web" }));

    const verdict = await submitAndAwaitVerdict(socketPath, "b.ts", () => {
      answering.write(encode({ type: "verdict", id: reviewId, questions: [] }));
    });

    expect(verdict.type).toBe("verdict");

    answering.destroy();
    silent.destroy();
    await server.close();
  });

  test("a client that drops after an offer does not block the others", async () => {
    const socketPath = join(isolated.tempDir("pair-bcast3-"), "s.sock");
    const server = await startSessionServer({ socketPath });

    const staying = await connectClient(socketPath);
    const leaving = await connectClient(socketPath);

    let reviewId = "";

    onMessage(staying, (message) => {
      if (message.type === "review") {
        reviewId = message.id;
      }
    });

    staying.write(encode({ type: "attach", client: "tui" }));
    leaving.write(encode({ type: "attach", client: "web" }));

    const verdict = await submitAndAwaitVerdict(socketPath, "c.ts", () => {
      leaving.destroy();
      staying.write(encode({ type: "verdict", id: reviewId, questions: [] }));
    });

    expect(verdict.type).toBe("verdict");

    staying.destroy();
    await server.close();
  });
});
```

Write `connectClient`, `onMessage`, and `submitAndAwaitVerdict` at the top of this file. Copy their shapes from `test/session-server.test.ts` rather than inventing new ones. `submitAndAwaitVerdict` opens a second connection, writes a `submit`, invokes the callback once a review has been offered, and resolves on the `verdict` frame that comes back.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/session-server.test.ts test/session-broadcast.test.ts`

Expected: FAIL. The server still hands each review to one client.

- [ ] **Step 4: Replace the client bookkeeping**

In `src/transports/session/server.ts`, replace the `clients` map with a set and add a holders map:

```ts
  const clients = new Set<Socket>();
  const holders = new Map<string, Set<Socket>>();
```

- [ ] **Step 5: Rewrite dispatch**

Replace `idleClient`, `clientHolding`, and `dispatch` with:

```ts
  // Every attached client is a view of one review, so all of them see it and the first verdict ends it.
  function dispatch(): void {
    if (clients.size > 0) {
      const result = offerAll(queue);
      queue = result.state;

      result.reviews.forEach((review) => {
        holders.set(review.id, new Set(clients));

        clients.forEach((client) => {
          send(client, {
            type: "review",
            id: review.id,
            tool: review.request.tool,
            path: review.request.filePath,
            before: review.request.before,
            after: review.request.after,
          });
        });
      });
    }

    announce();
  }
```

- [ ] **Step 6: Rewrite the attach, verdict, and drop handlers**

```ts
  function handleAttach(socket: Socket): void {
    clients.add(socket);
    lastAttachAt = new Date().toISOString();
    dispatch();
  }

  // The first verdict wins. Every other client holding the same review hears cancel instead.
  function handleVerdict(socket: Socket, message: VerdictMessage): void {
    const held = holders.get(message.id);

    if (held === undefined) {
      return;
    }

    const agent = agents.get(message.id);

    if (agent !== undefined) {
      send(agent, message);
      agents.delete(message.id);
    }

    held.forEach((client) => {
      if (client !== socket) {
        send(client, { type: "cancel", id: message.id });
      }
    });

    holders.delete(message.id);
    queue = complete(queue, message.id);

    dispatch();
  }

  function dropAgent(socket: Socket): void {
    const owned = [...agents.entries()].filter(([, agentSocket]) => agentSocket === socket);

    owned.forEach(([id]) => {
      agents.delete(id);

      holders.get(id)?.forEach((client) => send(client, { type: "cancel", id }));
      holders.delete(id);

      queue = complete(queue, id);
    });

    if (owned.length > 0) {
      dispatch();
    }
  }

  // The last client to drop hands its reviews back, so a fresh attach picks them up.
  function dropClient(socket: Socket): void {
    if (!clients.delete(socket)) {
      return;
    }

    holders.forEach((held, id) => {
      held.delete(socket);

      if (held.size === 0 && findReview(queue, id) !== null) {
        queue = release(queue, id);
        holders.delete(id);
      }
    });

    dispatch();
  }
```

Add `let lastAttachAt: string | null = null;` beside the other closure state.

Add the accessor to the returned object in the same step, so the variable is read and
`oxlint` does not flag it:

```ts
    lastAttachAt(): string | null {
      return lastAttachAt;
    },
```

Add the same method to `SessionServer` in `src/transports/session/server.types.ts`:

```ts
  lastAttachAt(): string | null;
```

- [ ] **Step 7: Fix the imports**

In `src/transports/session/server.ts`, replace `takeNext` with `offerAll` in the queue import.

- [ ] **Step 8: Correct clientCount**

Replace the `clientCount` implementation in the returned object:

```ts
    clientCount(): number {
      return clients.size;
    },
```

`clients` is now a `Set`, so `.size` still reads correctly.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run test/session-server.test.ts test/session-broadcast.test.ts test/session-queue.test.ts`

Expected: PASS.

- [ ] **Step 10: Run the full gates**

Run: `npx vitest run && npx tsc --noEmit && npx oxlint && npx oxfmt --check`

Expected: all pass. Watch `test/cli-watch.test.ts` and `test/web-server.test.ts` closely, because both drive a real socket end to end.

- [ ] **Step 11: Update the changelog and commit**

Add under `## [Unreleased]` in `CHANGELOG.md`:

```markdown
### Changed

- Every attached client receives every review. The first verdict completes it, and the other clients receive a cancel.
```

```bash
git add src/transports/session CHANGELOG.md test/session-queue.test.ts test/session-server.test.ts test/session-broadcast.test.ts
git commit -m "feat(session): broadcast each review and let the first verdict win"
git push -u origin feat/broadcast-reviews/pm-17
```

Then open the pull request against `main`. Do not merge it.

---

# PR 3 — Sessions listing, connect, and cleanup

Branch: `feat/sessions-listing/pm-18`

Create it after PR 2 merges.

```bash
git checkout main
git pull
git checkout -b feat/sessions-listing/pm-18
```

---

### Task 10: The status and state wire frames

**Files:**
- Modify: `src/transports/session/wire.ts`
- Modify: `src/transports/session/wire.types.ts`
- Modify: `src/transports/session/server.ts`
- Modify: `src/transports/session/server.types.ts`
- Modify: `src/transports/session/index.ts`
- Test: `test/session-wire.test.ts`
- Test: `test/session-server.test.ts`

**Interfaces:**
- Consumes: the broadcast server from Task 9.
- Produces:
  - `interface StatusMessage { type: "status" }`
  - `interface StateMessage { type: "state"; clientCount: number; waitingDepth: number; lastAttachAt: string | null }`
  - `SessionServer` gains `lastAttachAt(): string | null`

- [ ] **Step 1: Write the failing wire test**

Append to `test/session-wire.test.ts`:

```ts
describe("the status and state frames", () => {
  test("a status frame round trips", () => {
    const line = encode({ type: "status" }).trim();

    expect(decodeLine(line)).toEqual({ type: "status" });
  });

  test("a state frame round trips", () => {
    const message = {
      type: "state" as const,
      clientCount: 2,
      waitingDepth: 1,
      lastAttachAt: "2026-09-01T10:00:00.000Z",
    };

    expect(decodeLine(encode(message).trim())).toEqual(message);
  });

  test("a state frame with a null lastAttachAt round trips", () => {
    const message = {
      type: "state" as const,
      clientCount: 0,
      waitingDepth: 0,
      lastAttachAt: null,
    };

    expect(decodeLine(encode(message).trim())).toEqual(message);
  });

  test("a state frame with a non-numeric count decodes to null", () => {
    const line = JSON.stringify({ type: "state", clientCount: "two", waitingDepth: 0, lastAttachAt: null });

    expect(decodeLine(line)).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing server test**

Append to `test/session-server.test.ts`:

```ts
test("a status request answers with the live state", async () => {
  const socketPath = join(isolated.tempDir("pair-status-"), "s.sock");
  const server = await startSessionServer({ socketPath });

  const client = await connectClient(socketPath);
  client.write(encode({ type: "attach", client: "tui" }));
  await settle();

  const asker = await connectClient(socketPath);
  const state = await requestState(asker);

  expect(state.clientCount).toBe(1);
  expect(state.waitingDepth).toBe(0);
  expect(typeof state.lastAttachAt).toBe("string");

  client.destroy();
  asker.destroy();
  await server.close();
});

test("lastAttachAt stays null until a client attaches", async () => {
  const socketPath = join(isolated.tempDir("pair-status2-"), "s.sock");
  const server = await startSessionServer({ socketPath });

  expect(server.lastAttachAt()).toBeNull();

  await server.close();
});
```

Write a `requestState` helper alongside the file's existing helpers. It writes a `status` frame and resolves on the `state` frame that comes back.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/session-wire.test.ts test/session-server.test.ts`

Expected: FAIL. `decodeLine` returns null for a `status` line.

- [ ] **Step 4: Add the message types**

In `src/transports/session/wire.types.ts`, add:

```ts
export interface StatusMessage {
  type: "status";
}

export interface StateMessage {
  type: "state";
  clientCount: number;
  waitingDepth: number;
  lastAttachAt: string | null;
}
```

Add `StatusMessage` to `ClientMessage`, `StateMessage` to `ServerMessage`, and both to `WireMessage`.

- [ ] **Step 5: Encode and decode them**

In `src/transports/session/wire.ts`, add:

```ts
function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toState(raw: Record<string, unknown>): StateMessage | null {
  const lastAttachAt = raw["lastAttachAt"];

  if (lastAttachAt !== null && !isString(lastAttachAt)) {
    return null;
  }

  if (!isNumber(raw["clientCount"]) || !isNumber(raw["waitingDepth"])) {
    return null;
  }

  return {
    type: "state",
    clientCount: raw["clientCount"],
    waitingDepth: raw["waitingDepth"],
    lastAttachAt,
  };
}
```

In `decodeLine`, add these two branches before the final `return null`:

```ts
  if (type === "status") {
    return { type: "status" };
  }

  if (type === "state") {
    return toState(parsed);
  }
```

Import both new types at the top of the file.

- [ ] **Step 6: Answer status in the server**

In `src/transports/session/server.ts`, add to `handleLine`, before the `verdict` branch:

```ts
    if (message.type === "status") {
      send(socket, {
        type: "state",
        clientCount: clients.size,
        waitingDepth: waitingDepth(queue),
        lastAttachAt,
      });
      return;
    }
```

Task 9 already added the `lastAttachAt` accessor and its type, so this step only adds the
wire branch above.

- [ ] **Step 7: Export the new types**

Add `StatusMessage` and `StateMessage` to the type exports in `src/transports/session/index.ts`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run test/session-wire.test.ts test/session-server.test.ts`

Expected: PASS.

- [ ] **Step 9: Run the full gates**

Run: `npx vitest run && npx tsc --noEmit && npx oxlint && npx oxfmt --check`

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/transports/session test/session-wire.test.ts test/session-server.test.ts
git commit -m "feat(session): answer a status request with the live client count"
```

---

### Task 11: Write and read the session sidecar

**Files:**
- Modify: `src/transports/session/server.ts`
- Modify: `src/transports/session/server.types.ts`
- Modify: `src/cli/watch/watch.ts`
- Modify: `src/web/watch.ts`
- Test: `test/session-server.test.ts`

**Interfaces:**
- Consumes: `SessionRecord` from Task 1, `sessionKeyRecordPath` from Task 1.
- Produces:
  - `SessionServerOptions` gains `record?: SessionRecord`
  - The server writes the record to `<socketPath minus .sock>.json` on bind, and removes it on close

- [ ] **Step 1: Write the failing test**

Append to `test/session-server.test.ts`:

```ts
test("the server writes its record beside the socket and removes it on close", async () => {
  const directory = isolated.tempDir("pair-record-");
  const socketPath = join(directory, "s-abcdef12.sock");
  const recordPath = join(directory, "s-abcdef12.json");

  const record = {
    id: "s-abcdef12",
    kind: "session" as const,
    label: "pair-mode@main",
    directory: "/repo",
    branch: "main",
    agentSessionId: "abc",
    agentKind: "claude-code",
    createdAt: "2026-09-01T10:00:00.000Z",
    pid: 1234,
  };

  const server = await startSessionServer({ socketPath, record });

  expect(existsSync(recordPath)).toBe(true);
  expect(JSON.parse(readFileSync(recordPath, "utf-8"))).toEqual(record);

  await server.close();

  expect(existsSync(recordPath)).toBe(false);
});

test("a server with no record writes no sidecar", async () => {
  const directory = isolated.tempDir("pair-record2-");
  const socketPath = join(directory, "s-abcdef34.sock");

  const server = await startSessionServer({ socketPath });

  expect(existsSync(join(directory, "s-abcdef34.json"))).toBe(false);

  await server.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/session-server.test.ts`

Expected: FAIL. TypeScript rejects `record` as an unknown option.

- [ ] **Step 3: Add the option**

In `src/transports/session/server.types.ts`, add to `SessionServerOptions`:

```ts
  record?: SessionRecord;
```

Import the type: `import type { SessionRecord } from "../../core/state";`

- [ ] **Step 4: Write and remove the sidecar**

In `src/transports/session/server.ts`, add above `startSessionServer`:

```ts
// The sidecar names a session for `pair-mode sessions`, so a person reads a label rather than a socket path.
function recordPathFor(socketPath: string): string {
  return socketPath.replace(/\.sock$/, ".json");
}

function writeRecord(socketPath: string, record: SessionRecord): void {
  try {
    writeFileSync(recordPathFor(socketPath), JSON.stringify(record, null, 2) + "\n", "utf-8");
  } catch {
    // A sidecar that fails to write must never stop a watcher from serving reviews.
  }
}
```

After `await bindSocket(server, options.socketPath);` add:

```ts
  if (options.record !== undefined) {
    writeRecord(options.socketPath, options.record);
  }
```

Inside `close`, add `removeQuietly(recordPathFor(options.socketPath));` beside the existing `removeQuietly(options.socketPath)`.

Add `writeFileSync` to the `node:fs` import and `SessionRecord` to the type imports.

- [ ] **Step 5: Build the record in both watchers**

In `src/cli/watch/watch.ts`, add above `runWatch`:

```ts
function currentBranch(directory: string): string | null {
  const result = spawnSync("git", ["-C", directory, "rev-parse", "--abbrev-ref", "HEAD"], {
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    return null;
  }

  const branch = result.stdout.trim();
  return branch === "" ? null : branch;
}

// A person reads the label, not the id, so it names the checkout and the branch.
function sessionLabel(directory: string, branch: string | null): string {
  const name = basename(directory);
  return branch === null ? name : `${name}@${branch}`;
}

function buildRecord(options: WatchOptions, socketPath: string): SessionRecord {
  const branch = currentBranch(options.directory);
  const kind: SessionKind = options.sessionKey === undefined ? "directory" : "session";

  return {
    id: options.sessionKey ?? basename(socketPath, ".sock"),
    kind,
    label: sessionLabel(options.directory, branch),
    directory: options.directory,
    branch,
    agentSessionId: options.agentSessionId ?? null,
    agentKind: options.agentKind ?? null,
    createdAt: new Date().toISOString(),
    pid: process.pid,
  };
}
```

Pass `record: buildRecord(options, socketPath)` into the `startSessionServer` call.

Add `agentSessionId?: string` and `agentKind?: string` to `WatchOptions` in `src/cli/watch/watch.types.ts`.

Apply the identical treatment to `src/web/watch.ts` and `src/web/watch.types.ts`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/session-server.test.ts`

Expected: PASS.

- [ ] **Step 7: Run the full gates**

Run: `npx vitest run && npx tsc --noEmit && npx oxlint && npx oxfmt --check`

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/transports/session src/cli/watch src/web test/session-server.test.ts
git commit -m "feat(session): record a label and a directory beside each socket"
```

---

### Task 12: The sessions listing and the sweep

**Files:**
- Create: `src/cli/sessions/sessions.ts`
- Create: `src/cli/sessions/sessions.types.ts`
- Create: `src/cli/sessions/index.ts`
- Test: `test/cli-sessions.test.ts`

**Interfaces:**
- Consumes: `probeSocket` from the session module, `sessionsDir` and `SessionRecord` from Task 1, the `status` frame from Task 10.
- Produces:
  - `interface SessionListing { id: string; kind: SessionKind; label: string; directory: string; clients: number; waiting: number; createdAt: string; alive: boolean }`
  - `interface SessionsResult { listings: SessionListing[]; swept: string[]; text: string; exitCode: number }`
  - `listSessions(): Promise<SessionsResult>` — probes every socket, sweeps the dead, returns the live ones
  - `sweepDeadSessions(): Promise<string[]>` — the sweep alone, for `watch` and `on` to call

- [ ] **Step 1: Write the failing test**

Create `test/cli-sessions.test.ts`:

```ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, describe } from "vitest";
import { useIsolatedHome } from "./helpers/env";
import { listSessions, sweepDeadSessions } from "../src/cli/sessions";
import { startSessionServer, encode } from "../src/transports/session";
import { sessionsDir } from "../src/core/state";

const isolated = useIsolatedHome();

function writeRecord(id: string, label: string, directory: string): void {
  mkdirSync(sessionsDir(), { recursive: true });

  const record = {
    id,
    kind: "session",
    label,
    directory,
    branch: "main",
    agentSessionId: "abc",
    agentKind: "claude-code",
    createdAt: "2026-09-01T10:00:00.000Z",
    pid: process.pid,
  };

  writeFileSync(join(sessionsDir(), `${id}.json`), JSON.stringify(record), "utf-8");
}

describe("listSessions", () => {
  test("reports a live session with its label and client count", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const id = "s-11111111";
    const socketPath = join(sessionsDir(), `${id}.sock`);

    writeRecord(id, "pair-mode@main", "/repo");
    const server = await startSessionServer({ socketPath });

    const result = await listSessions();

    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.id).toBe(id);
    expect(result.listings[0]?.label).toBe("pair-mode@main");
    expect(result.listings[0]?.clients).toBe(0);
    expect(result.text).toContain("pair-mode@main");

    await server.close();
  });

  test("sweeps a dead socket with its sidecar", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const id = "s-22222222";
    const socketPath = join(sessionsDir(), `${id}.sock`);
    const recordPath = join(sessionsDir(), `${id}.json`);

    writeRecord(id, "dead@main", "/repo");
    writeFileSync(socketPath, "", "utf-8");

    const result = await listSessions();

    expect(result.listings).toHaveLength(0);
    expect(result.swept).toContain(id);
    expect(existsSync(socketPath)).toBe(false);
    expect(existsSync(recordPath)).toBe(false);
  });

  test("spares a live socket during a sweep", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const id = "s-33333333";
    const socketPath = join(sessionsDir(), `${id}.sock`);

    writeRecord(id, "live@main", "/repo");
    const server = await startSessionServer({ socketPath });

    const swept = await sweepDeadSessions();

    expect(swept).toEqual([]);
    expect(existsSync(socketPath)).toBe(true);

    await server.close();
  });

  test("a live socket with no sidecar still lists, with an unknown label", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const id = "s-44444444";
    const socketPath = join(sessionsDir(), `${id}.sock`);
    const server = await startSessionServer({ socketPath });

    const result = await listSessions();

    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.label).toBe("unknown");

    await server.close();
  });

  test("a malformed sidecar never hides a live socket", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const id = "s-55555555";
    const socketPath = join(sessionsDir(), `${id}.sock`);

    writeFileSync(join(sessionsDir(), `${id}.json`), "{ not json", "utf-8");
    const server = await startSessionServer({ socketPath });

    const result = await listSessions();

    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.id).toBe(id);

    await server.close();
  });

  test("an empty sessions directory reports no sessions and exits 0", async () => {
    const result = await listSessions();

    expect(result.listings).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain("no pair-mode sessions");
  });

  test("the client count reflects a real attach", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const id = "s-66666666";
    const socketPath = join(sessionsDir(), `${id}.sock`);

    writeRecord(id, "attached@main", "/repo");
    const server = await startSessionServer({ socketPath });

    const client = await connectClient(socketPath);
    client.write(encode({ type: "attach", client: "tui" }));
    await settle();

    const result = await listSessions();

    expect(result.listings[0]?.clients).toBe(1);

    client.destroy();
    await server.close();
  });
});
```

Write `connectClient` and `settle` at the top of the file, copying their shapes from `test/session-server.test.ts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/cli-sessions.test.ts`

Expected: FAIL. The module `../src/cli/sessions` does not exist.

- [ ] **Step 3: Write the types**

Create `src/cli/sessions/sessions.types.ts`:

```ts
import type { SessionKind } from "../../core/state";

export interface SessionListing {
  id: string;
  kind: SessionKind;
  label: string;
  directory: string;
  clients: number;
  waiting: number;
  createdAt: string;
  alive: boolean;
}

export interface SessionsResult {
  listings: SessionListing[];
  swept: string[];
  text: string;
  exitCode: number;
}
```

- [ ] **Step 4: Write the module**

Create `src/cli/sessions/sessions.ts`:

```ts
import { createConnection } from "node:net";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { sessionsDir } from "../../core/state";
import type { SessionKind, SessionRecord } from "../../core/state";
import { createLineReader, decodeLine, encode } from "../../transports/session";
import type { StateMessage } from "../../transports/session";
import { removeQuietly, isRecord } from "../../helpers";
import type { SessionListing, SessionsResult } from "./sessions.types";

const STATUS_TIMEOUT_MS = 250;
const UNKNOWN_LABEL = "unknown";

// A socket that answers a status request is live. Anything else is a file a crashed watcher left behind.
function askStatus(socketPath: string): Promise<StateMessage | null> {
  return new Promise((resolve) => {
    let settled = false;

    const settle = (state: StateMessage | null): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(state);
    };

    const timer = setTimeout(() => settle(null), STATUS_TIMEOUT_MS);

    const socket = createConnection(socketPath);
    socket.setEncoding("utf-8");

    const readLines = createLineReader();

    socket.on("error", () => settle(null));
    socket.on("close", () => settle(null));

    socket.on("data", (chunk: string) => {
      readLines(chunk).forEach((line) => {
        const message = decodeLine(line);

        if (message?.type === "state") {
          settle(message);
        }
      });
    });

    socket.on("connect", () => socket.write(encode({ type: "status" })));
  });
}

function isSessionRecord(value: unknown): value is SessionRecord {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value["label"] === "string" && typeof value["directory"] === "string";
}

// A malformed sidecar must never hide a live socket, so a failed read degrades to an unknown label.
function readRecord(id: string): SessionRecord | null {
  const path = join(sessionsDir(), `${id}.json`);

  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return isSessionRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sessionIds(): string[] {
  try {
    return readdirSync(sessionsDir())
      .filter((name) => name.endsWith(".sock"))
      .map((name) => basename(name, ".sock"))
      .sort();
  } catch {
    return [];
  }
}

function removeSession(id: string): void {
  [".sock", ".json", ".url"].forEach((extension) =>
    removeQuietly(join(sessionsDir(), `${id}${extension}`)),
  );
}

function kindOf(id: string, record: SessionRecord | null): SessionKind {
  if (record !== null) {
    return record.kind;
  }

  return id.startsWith("s-") ? "session" : "directory";
}

function toListing(id: string, state: StateMessage): SessionListing {
  const record = readRecord(id);

  return {
    id,
    kind: kindOf(id, record),
    label: record?.label ?? UNKNOWN_LABEL,
    directory: record?.directory ?? "",
    clients: state.clientCount,
    waiting: state.waitingDepth,
    createdAt: record?.createdAt ?? "",
    alive: true,
  };
}

async function scan(): Promise<{ listings: SessionListing[]; swept: string[] }> {
  const ids = sessionIds();
  const states = await Promise.all(ids.map((id) => askStatus(join(sessionsDir(), `${id}.sock`))));

  const listings: SessionListing[] = [];
  const swept: string[] = [];

  ids.forEach((id, index) => {
    const state = states[index];

    if (state === undefined || state === null) {
      removeSession(id);
      swept.push(id);
      return;
    }

    listings.push(toListing(id, state));
  });

  return { listings, swept };
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function formatTable(listings: SessionListing[]): string {
  const header = ["ID", "LABEL", "KIND", "WATCHERS", "QUEUED"];
  const rows = listings.map((entry) => [
    entry.id,
    entry.label,
    entry.kind,
    String(entry.clients),
    String(entry.waiting),
  ]);

  const widths = header.map((name, column) =>
    Math.max(name.length, ...rows.map((row) => row[column]?.length ?? 0)),
  );

  const line = (cells: string[]): string =>
    cells.map((cell, column) => pad(cell, widths[column] ?? 0)).join("  ").trimEnd();

  return [line(header), ...rows.map(line)].join("\n");
}

export async function listSessions(): Promise<SessionsResult> {
  const { listings, swept } = await scan();

  const text = listings.length === 0 ? "no pair-mode sessions" : formatTable(listings);

  return { listings, swept, text, exitCode: 0 };
}

export async function sweepDeadSessions(): Promise<string[]> {
  const { swept } = await scan();
  return swept;
}
```

- [ ] **Step 5: Write the index**

Create `src/cli/sessions/index.ts`:

```ts
export { listSessions, sweepDeadSessions } from "./sessions";
export type { SessionListing, SessionsResult } from "./sessions.types";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/cli-sessions.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 7: Run the full gates**

Run: `npx vitest run && npx tsc --noEmit && npx oxlint && npx oxfmt --check`

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/cli/sessions test/cli-sessions.test.ts
git commit -m "feat(cli): list live sessions and sweep the dead ones"
```

---

### Task 13: The connect picker

**Files:**
- Create: `src/cli/sessions/connect.ts`
- Modify: `src/cli/sessions/index.ts`
- Test: `test/cli-sessions.test.ts`

**Interfaces:**
- Consumes: `listSessions` from Task 12.
- Produces:
  - `runConnect(io: ConnectIo): Promise<{ selected: string | null; exitCode: number }>`
  - `interface ConnectIo` in `sessions.types.ts` with `isTty(): boolean`, `write(text: string): void`, `onKey(handler: (key: string) => void): void`, `shutdown(): void`

- [ ] **Step 1: Write the failing test**

Append to `test/cli-sessions.test.ts`:

```ts
describe("runConnect", () => {
  function fakeIo(tty: boolean) {
    const written: string[] = [];
    let handler: ((key: string) => void) | null = null;

    return {
      written,
      pressKey(key: string) {
        handler?.(key);
      },
      io: {
        isTty: () => tty,
        write: (text: string) => written.push(text),
        onKey: (next: (key: string) => void) => {
          handler = next;
        },
        shutdown: () => {},
      },
    };
  }

  test("with no TTY it exits 1 and names the sessions command", async () => {
    const fake = fakeIo(false);
    const result = await runConnect(fake.io);

    expect(result.exitCode).toBe(1);
    expect(result.selected).toBeNull();
    expect(fake.written.join("")).toContain("pair-mode sessions");
  });

  test("Enter selects the session under the cursor", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const id = "s-77777777";
    const socketPath = join(sessionsDir(), `${id}.sock`);

    writeRecord(id, "picked@main", "/repo");
    const server = await startSessionServer({ socketPath });

    const fake = fakeIo(true);
    const run = runConnect(fake.io);

    await settle();
    fake.pressKey("\r");

    const result = await run;

    expect(result.selected).toBe(id);
    expect(result.exitCode).toBe(0);

    await server.close();
  });

  test("j moves the cursor down before Enter selects", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const first = "s-88888888";
    const second = "s-99999999";

    writeRecord(first, "one@main", "/repo");
    writeRecord(second, "two@main", "/repo");

    const serverOne = await startSessionServer({ socketPath: join(sessionsDir(), `${first}.sock`) });
    const serverTwo = await startSessionServer({ socketPath: join(sessionsDir(), `${second}.sock`) });

    const fake = fakeIo(true);
    const run = runConnect(fake.io);

    await settle();
    fake.pressKey("j");
    fake.pressKey("\r");

    const result = await run;

    expect(result.selected).toBe(second);

    await serverOne.close();
    await serverTwo.close();
  });

  test("q quits without selecting", async () => {
    mkdirSync(sessionsDir(), { recursive: true });

    const id = "s-aaaaaaaa";
    writeRecord(id, "quit@main", "/repo");
    const server = await startSessionServer({ socketPath: join(sessionsDir(), `${id}.sock`) });

    const fake = fakeIo(true);
    const run = runConnect(fake.io);

    await settle();
    fake.pressKey("q");

    const result = await run;

    expect(result.selected).toBeNull();
    expect(result.exitCode).toBe(0);

    await server.close();
  });

  test("with a TTY and no sessions it exits 0 and says so", async () => {
    const fake = fakeIo(true);
    const result = await runConnect(fake.io);

    expect(result.exitCode).toBe(0);
    expect(result.selected).toBeNull();
    expect(fake.written.join("")).toContain("no pair-mode sessions");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/cli-sessions.test.ts`

Expected: FAIL. `runConnect` is not exported.

- [ ] **Step 3: Add the IO type**

Append to `src/cli/sessions/sessions.types.ts`:

```ts
export interface ConnectIo {
  isTty(): boolean;
  write(text: string): void;
  onKey(handler: (key: string) => void): void;
  shutdown(): void;
}

export interface ConnectResult {
  selected: string | null;
  exitCode: number;
}
```

- [ ] **Step 4: Write the picker**

Create `src/cli/sessions/connect.ts`:

```ts
import { listSessions } from "./sessions";
import type { ConnectIo, ConnectResult, SessionListing } from "./sessions.types";

const CLEAR_SCREEN = "\x1b[2J\x1b[H";
const DOWN_KEYS = ["j", "\x1b[B"];
const UP_KEYS = ["k", "\x1b[A"];
const SELECT_KEYS = ["\r", "\n"];
const QUIT_KEYS = ["q", "\x1b", "\x03"];

function paint(io: ConnectIo, listings: SessionListing[], cursor: number): void {
  const rows = listings.map((entry, index) => {
    const marker = index === cursor ? ">" : " ";
    return `${marker} ${entry.id}  ${entry.label}  ${entry.clients} watching`;
  });

  const help = "j/k move · Enter watches · q quits";

  io.write(`${CLEAR_SCREEN}pair mode sessions\r\n\r\n${rows.join("\r\n")}\r\n\r\n${help}\r\n`);
}

// The picker owns stdin for its whole run, so every exit path shuts the IO down before it resolves.
export async function runConnect(io: ConnectIo): Promise<ConnectResult> {
  if (!io.isTty()) {
    io.write("connect needs a terminal; run pair-mode sessions instead\n");
    return { selected: null, exitCode: 1 };
  }

  const result = await listSessions();

  if (result.listings.length === 0) {
    io.write("no pair-mode sessions\n");
    return { selected: null, exitCode: 0 };
  }

  const listings = result.listings;

  return await new Promise<ConnectResult>((resolve) => {
    let cursor = 0;

    const finish = (selected: string | null): void => {
      io.shutdown();
      resolve({ selected, exitCode: 0 });
    };

    io.onKey((key) => {
      if (QUIT_KEYS.includes(key)) {
        finish(null);
        return;
      }

      if (SELECT_KEYS.includes(key)) {
        finish(listings[cursor]?.id ?? null);
        return;
      }

      if (DOWN_KEYS.includes(key)) {
        cursor = Math.min(cursor + 1, listings.length - 1);
      }

      if (UP_KEYS.includes(key)) {
        cursor = Math.max(cursor - 1, 0);
      }

      paint(io, listings, cursor);
    });

    paint(io, listings, cursor);
  });
}

// The picker claims stdin the same way the watcher does, and it restores the prior raw mode on shutdown.
export function createConnectIo(): ConnectIo {
  const wasRaw = process.stdin.isRaw === true;
  let keyHandler: ((key: string) => void) | null = null;

  process.stdin.setEncoding("utf8");

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.resume();

  process.stdin.on("data", (chunk) => {
    keyHandler?.(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  });

  return {
    isTty(): boolean {
      return process.stdin.isTTY === true;
    },

    write(text: string): void {
      process.stdout.write(text);
    },

    onKey(handler: (key: string) => void): void {
      keyHandler = handler;
    },

    shutdown(): void {
      keyHandler = null;

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(wasRaw);
      }

      process.stdin.pause();
    },
  };
}
```


- [ ] **Step 5: Export it**

Add to `src/cli/sessions/index.ts`:

```ts
export { runConnect, createConnectIo } from "./connect";
export type { ConnectIo, ConnectResult } from "./sessions.types";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/cli-sessions.test.ts`

Expected: PASS, 13 tests.

- [ ] **Step 7: Run the full gates**

Run: `npx vitest run && npx tsc --noEmit && npx oxlint && npx oxfmt --check`

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/cli/sessions test/cli-sessions.test.ts
git commit -m "feat(cli): add an interactive session picker"
```

---

### Task 14: Dispatch the commands, sweep on start, fix doctor, then open PR 3

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `src/cli/doctor/doctor.ts`
- Modify: `src/cli/watch/watch.ts`
- Modify: `src/cli/toggle.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Test: `test/cli-toggle-web.test.ts`

**Interfaces:**
- Consumes: `listSessions`, `sweepDeadSessions`, `runConnect` from Tasks 12 and 13.
- Produces: no new exports.

- [ ] **Step 1: Write the failing doctor test**

In `test/cli-toggle-web.test.ts`, find the test that asserts doctor names the `rm` command for a stale socket, at roughly line 89. Replace it with:

```ts
test("doctor removes a stale socket rather than naming rm", async () => {
  const directory = isolated.tempDir("pair-doctor-stale-");
  const socketPath = sessionSocketPath(directory);

  mkdirSync(dirname(socketPath), { recursive: true });
  writeFileSync(socketPath, "", "utf-8");

  const report = await runDoctor({
    config: { ...DEFAULT_CONFIG, transport: "session" },
    probeSocket: async () => false,
  });

  expect(report.text).toContain("removed a stale socket");
  expect(report.text).not.toContain("rm ");
  expect(existsSync(socketPath)).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/cli-toggle-web.test.ts`

Expected: FAIL. Doctor still prints `rm`.

- [ ] **Step 3: Make doctor remove the socket**

In `src/cli/doctor/doctor.ts`, replace the final return of `checkSession`:

```ts
  removeQuietly(path);

  return { name, passed: true, detail: "removed a stale socket", warnOnly: true };
```

Add `removeQuietly` to the helpers import.

- [ ] **Step 4: Dispatch sessions and connect**

In `src/cli/index.ts`, add before the `unknown command` fallback:

```ts
  if (command === "sessions") {
    const result = await listSessions();
    console.log(result.text);
    return result.exitCode;
  }

  if (command === "connect") {
    const result = await runConnect(createConnectIo());
    return result.exitCode;
  }
```

Task 13 already wrote and exported `createConnectIo`, so import it from `./sessions`.

When `runConnect` resolves with a non-null `selected`, `connect` continues into the review
pane rather than exiting. Extract the body of the existing `watch` branch into a function so
both commands call it:

```ts
async function watchSession(
  directory: string,
  sessionKey: string | undefined,
  wantsWeb: boolean,
): Promise<number> {
  const { config, errors } = loadConfig();

  errors.forEach((error) => console.error(`config ${error.path}: ${error.message}`));

  if (!wantsWeb && !config.web.enabled) {
    return await runWatch({ directory, sessionKey }, config);
  }

  const watcher = await startWebWatch({ directory, sessionKey, port: config.web.port }, config);

  console.log(`pair mode is watching ${directory}`);
  console.log(watcher.url);

  // The web watcher has no TTY loop of its own, so the process stays alive until a signal stops it.
  await new Promise<void>((done) => {
    const stop = (): void => {
      void watcher.close().then(done);
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  return 0;
}
```

The `watch` branch then calls `watchSession(parsed.directory, parsed.sessionKey, parsed.web)`.
The `connect` branch calls it with the picked id:

```ts
  if (command === "connect") {
    const result = await runConnect(createConnectIo());

    if (result.selected === null) {
      return result.exitCode;
    }

    return await watchSession(process.cwd(), result.selected, false);
  }
```

Add to `USAGE`, directly before the `--version` line:

```
  sessions             list every live pair mode session
  connect              pick a session from a list and watch it
```

- [ ] **Step 5: Sweep on watch and on**

In `src/cli/watch/watch.ts`, call `await sweepDeadSessions()` at the top of `runWatch`, before `startSessionServer`.

In `src/cli/toggle.ts`, call it at the top of `pairOn` and `pairOnWeb`. `pairOn` is currently synchronous. Leave it synchronous and instead call the sweep from the `on` branch in `src/cli/index.ts`, before it calls `pairOn`. That keeps the sweep out of the hot path and off a synchronous function.

- [ ] **Step 6: Update the README**

In `README.md`, add after the `### One socket per agent session` subsection from Task 7:

```markdown
### Finding a session

```
pair-mode sessions
```

That prints every live session with its id, its label, how many watchers are attached, and
how many reviews are queued. It also removes any socket whose watcher has died.

```
pair-mode connect
```

That opens the same list, interactive. `j`, `k`, and the arrow keys move the cursor. `Enter`
watches the session under the cursor. `q` quits.

`pair-mode watch <id>` attaches directly when you already know the id.

Several clients can watch one session at once. A terminal watcher and a browser tab both
receive every diff, and the first answer wins. The other client sees the review withdraw.
```

- [ ] **Step 7: Update the changelog**

Add under `## [Unreleased]` in `CHANGELOG.md`:

```markdown
### Added

- `pair-mode sessions` lists every live session and removes the dead ones.
- `pair-mode connect` picks a session from a list and watches it.
- `pair-mode watch <id>` attaches to one session.

### Changed

- `pair-mode doctor` removes a stale socket rather than printing an `rm` command.
```

- [ ] **Step 8: Verify by hand**

Run:

```bash
pnpm run build
CLAUDE_CODE_SESSION_ID=hand-test-one node dist/cli.js on /tmp
node dist/cli.js sessions
```

Expected: `sessions` prints one row naming the key that `on` printed.

Then kill the watcher, run `node dist/cli.js sessions` again, and confirm it reports the sweep and lists nothing.

- [ ] **Step 9: Run the full gates**

Run: `npx vitest run && npx tsc --noEmit && npx oxlint && npx oxfmt --check && pnpm run build`

Expected: all pass.

- [ ] **Step 10: Commit and open the PR**

```bash
git add src/cli README.md CHANGELOG.md test/cli-toggle-web.test.ts
git commit -m "feat(cli): add sessions and connect, and sweep dead sockets"
git push -u origin feat/sessions-listing/pm-18
```

Then open the pull request against `main`. Do not merge it.

---

## Verification across all three PRs

After PR 3 merges, run this end-to-end check by hand.

1. Open two terminal windows in the same checkout.
2. Start an agent session in each one, and run `/pair-mode:toggle` in both.
3. Run `pair-mode sessions` in a third terminal. Confirm two rows with distinct ids.
4. Run `pair-mode connect`, pick the first session, and leave the pane open.
5. Ask the first agent to edit a file. Confirm the diff appears in the pane.
6. Ask the second agent to edit a file. Confirm the pane does NOT show it.
7. Ask the first agent to spawn a subagent that edits a file. Confirm the diff reaches the same pane, because a subagent inherits the parent session id.
8. Quit the pane. Run `pair-mode sessions` and confirm the swept socket is gone.
9. Run `pair-mode on ~/dev/pair-mode` from a plain terminal, then `pair-mode watch` there.
10. Ask the second agent to edit a file. Confirm the directory watcher receives it, because that session has no watcher of its own.
