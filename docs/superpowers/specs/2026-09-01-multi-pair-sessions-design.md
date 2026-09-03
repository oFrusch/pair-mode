# Multi-pair sessions

Design document. 2026-09-01.

## The problem

`pair-mode` opens one Unix socket per directory. The socket path derives from a SHA-1 of
the resolved directory, in `src/core/state/state.ts:36-48`. A person who runs several
concurrent agent sessions in one repository therefore gets every session's diffs in every
watcher.

The dispatch loop makes this worse than a simple duplicate. `src/transports/session/server.ts:118-155`
implements a work-stealing queue. Exactly one attached client receives each review, and
map insertion order decides which one. Two watchers on one repository do not both see a
diff. They split the diffs between them, unpredictably.

The goal: each agent session gets its own socket, and a watcher attaches to exactly one.

## Verified evidence

Both harnesses carry a session identity in the `PreToolUse` payload. We confirmed this by
experiment, not by documentation.

| Fact                              | Claude Code                          | Codex 0.149.1                         |
| --------------------------------- | ------------------------------------ | ------------------------------------- |
| `session_id` in the payload       | yes                                  | yes                                   |
| Stable across resume              | yes, for `--resume` and `--continue` | yes, for `codex exec resume`          |
| A subagent inherits the parent id | yes                                  | yes                                   |
| A subagent adds                   | `agent_id`, `agent_type`             | `agent_id`, `agent_type`              |
| Environment variable              | `CLAUDE_CODE_SESSION_ID`             | `CODEX_SESSION_ID`, `CODEX_THREAD_ID` |

Method for Claude Code: a throwaway `PreToolUse` hook appended each raw payload to a JSONL
file. One run wrote a file directly and then delegated a second write to a
`general-purpose` subagent. Both payloads carried session id
`11111111-2222-3333-4444-555555555555`. The subagent payload added
`agent_id: "aa29cc4a6dee26179"` and `agent_type: "general-purpose"`.

Method for Codex: the same probe, run by Codex against itself. Its evidence is in
`docs/notes/codex-session-identity-probe.md`.

Two findings from that probe change our code.

1. A new Codex hook requires explicit trust. Without trust, Codex runs the tool and skips
   the hook silently. Our first probe attempts failed for this reason.
2. In a nested context, the environment variable can carry the outer session id. The
   payload stays correct.

Rule that follows: the hook reads `session_id` from the payload. The hook never reads the
environment. Only `pair-mode on` reads the environment, because it receives no payload.

## The key

```
sessionKey(sessionId) = sha1(sessionId).slice(0, 8)
```

Eight hex characters. A person types this after `watch`. Eight characters do not collide
across the number of sessions one person opens.

## Socket resolution

Directory sockets keep their current names, so no state migrates. Session sockets take an
`s-` prefix.

```
~/.local/state/pair-mode/sessions/
  s-a3f91c2b.sock    s-a3f91c2b.json      session-keyed
  4f2c...e91a.sock   4f2c...e91a.json     directory-keyed, unchanged
```

The hook resolves a socket in this order.

1. The payload carries a `session_id`, and `s-<key>.sock` exists. Use it.
2. Walk up from the file path to a directory socket. Use it.
3. Fail open. The edit applies.

Step 2 preserves today's behaviour. A directory watcher becomes the catch-all tier. It
receives every session that has no watcher of its own. This needs no filter protocol and
no second code path.

## The flag follows the same chain

`isEnabled` in `src/core/state/state.ts:71-87` walks up directories for a `.on` file. The
flag gains three states, not two, so a session can opt out of a directory default.

1. `s-<key>.off` exists. Pair mode is off for this session. Stop.
2. `s-<key>.on` exists. Pair mode is on for this session. Stop.
3. Walk up for the directory flag. Pair mode is on for this directory.
4. Pair mode is off.

`pair-mode on` inside an agent writes the session flag and removes any session opt-out.
`pair-mode on <dir>` from a plain terminal writes the directory flag.

Without the session tier, `pair on` in session A silently holds session B's edits in the
same checkout. Session B then resolves no socket and fails open on every write.

### Why `off` needs a third state

A bare `pair-mode off` inside an agent must mean "off for me". Consider a directory flag
that is on, in a session that has no session flag. Two states leave only bad options. The
command clears nothing, which reads as a broken `off`. Or the command clears the directory
flag, which silently stops pair mode for every other session in the checkout.

The session opt-out removes that choice. A bare `off` always writes `s-<key>.off`. It never
touches another session, and it never does nothing.

`pair-mode off <dir>` names its target, so it clears the directory flag. Explicit target,
explicit scope.

`pair-mode toggle` reads the resolved state and flips the session tier only.

## What a session records

The watcher writes a sidecar JSON file when it binds its socket.

```
{
  "id": "s-a3f91c2b",
  "kind": "session",
  "label": "pair-mode@feat/multi-pair",
  "directory": "/Users/owen/dev/pair-mode",
  "branch": "feat/multi-pair",
  "agentSessionId": "d95655de-eb7f-45e5-867d-9797a355353e",
  "agentKind": "claude-code",
  "createdAt": "2026-09-01T10:00:00.000Z",
  "pid": 68755
}
```

`label` combines the checkout basename and the current branch. A person reads the label,
not the id.

## Live state travels on the wire

The sidecar holds only static facts. Counts change, so a file holding them goes stale.

A new wire request answers for live state.

```
{ "type": "status" }
{ "type": "state", "clientCount": 2, "waitingDepth": 0, "lastAttachAt": "..." }
```

`startSessionServer` already tracks all three values in its closure. `clients` at
`server.ts:104` gives `clientCount`. `waitingDepth` at `queue.ts:17` already exists. Only
`lastAttachAt` is new.

`pair-mode sessions` connects to each socket and sends `status`. That connection doubles
as the liveness probe, so the listing and the garbage collection become one operation.

## Several clients on one session

Today the server hands each review to exactly one client. `dispatch` at
`src/transports/session/server.ts:118-155` is a work-stealing queue, and map insertion
order picks the winner. A person with a terminal watcher and a browser tab open on the
same session sees diff 1 in the terminal and diff 2 in the browser.

That behaviour treats the clients as workers. They are views, and one human owns them all.

The server broadcasts each review to every attached client. The first verdict wins. The
server then sends `cancel` to the others and frees the review.

The web layer already works this way one level up. `src/web/server.ts:259-263` fans an
offer to every SSE viewer, `:196-200` answers a stale verdict with `409 CONFLICT`, and
`:205` broadcasts the cancel. This change lifts that same rule to the socket layer, so both
layers agree.

The server never waits for a second verdict. One answer completes the review.

This replaces the queue's `inFlight` single-holder model with a broadcast set. `release`
at `queue.ts:40-45` still returns a review to `waiting` when the last client drops.

## Garbage collection

One rule governs it: a socket that refuses a connection is dead. Its `.sock`, `.json`, and
`.url` files all go.

The sweep runs in three places.

1. `pair-mode sessions`, as it lists.
2. `pair-mode watch`, at startup.
3. `pair-mode on`, before it mints a socket.

`runDoctor` at `src/cli/doctor/doctor.ts:290-296` currently prints `stale socket, remove it
with: rm ...`. It performs the removal instead.

No age-based expiry. `probeSocket` at `server.ts:36-50` already exists, already has a
250 ms timeout, and answers authoritatively for one connect.

## Command surface

| Command                      | Behaviour                                                      |
| ---------------------------- | -------------------------------------------------------------- |
| `pair-mode on`               | Prints `pair mode on · s-a3f91c2b · pair-mode@feat/multi-pair` |
| `pair-mode sessions`         | Prints id, label, kind, watchers, queued, age, then exits      |
| `pair-mode connect`          | Opens the same list, interactive. Enter attaches               |
| `pair-mode watch <id>`       | Attaches to one session socket                                 |
| `pair-mode watch [dir]`      | Unchanged. Binds the directory socket                          |
| `pair-mode off`              | Writes the session opt-out. Never affects another session      |
| `pair-mode off <dir>`        | Clears the directory flag                                      |
| `pair-mode status`, `toggle` | Resolve through the same four-step chain                       |

`pair-mode connect` opens the same list, interactive. `j`, `k`, and the arrow keys move
the cursor. `Enter` attaches to the session under the cursor. `q` and `Esc` quit.

`sessions` stays non-interactive. It prints and exits, so a script can read it and so it
still works with no TTY. `connect` refuses to run without a TTY and tells the person to
run `sessions` instead.

The pair pane already owns a key loop and a row cursor. `connect` reuses that input
handling rather than adding a second one.

## Error handling

- The hook resolves no socket. It fails open and the edit applies. This matches
  `src/core/run/run.ts:23-25` today.
- A session socket exists but refuses a connection. The hook removes it, then falls to the
  directory tier.
- Two watchers try to bind the same session socket. `bindSocket` at `server.ts:84-96`
  already probes and refuses when the holder lives. That behaviour is unchanged.
- A sidecar file fails to parse. `sessions` shows the id and the kind, and marks the label
  unknown. A malformed sidecar never hides a live socket.
- `pair-mode watch <id>` names an unknown id. The command lists the known ids and exits 1.

## Files this touches

**Core keying**

- `src/core/state/state.ts` — key derivation, the two path families, both resolution chains
- `src/core/state/state.types.ts` — new file for `SessionKey`, `SessionKind`, `SessionRecord`
- `src/adapters/claude-code/claude-code.ts` — read `session_id` from the payload
- `src/adapters/codex/codex.ts` — same
- `src/core/run/run.ts` — thread the key to the transport
- `src/transports/session/client.ts` — the resolution chain
- `src/cli/toggle.ts` — key-aware `on`, `off`, `status`, `toggle`
- `src/web/watch.ts` — bind by key

**Listing and cleanup**

- `src/transports/session/wire.ts` and `wire.types.ts` — the `status` and `state` frames
- `src/transports/session/server.ts` — answer `status`, write the sidecar, track `lastAttachAt`
- `src/cli/sessions/` — new module for the listing and the sweep
- `src/cli/watch/watch.ts` — accept an id
- `src/cli/index.ts` — dispatch and USAGE
- `src/cli/doctor/doctor.ts` — sweep rather than suggest

## Tests

Existing files that this design changes:

- `test/state.test.ts` — path derivation. Add the two-tier resolution for both socket and flag.
- `test/session-server.test.ts` — add `status` and `lastAttachAt`. The test at line 194,
  "two attached clients each take one of two queued reviews", asserts the work-stealing
  behaviour this design replaces. Rewrite it to assert the broadcast: both clients receive
  both reviews, and one verdict completes each.
- `test/session-client.test.ts` — the resolution chain, including the fall from a dead
  session socket to a live directory socket.
- `test/cli-toggle.test.ts` — USAGE text at line 177, and session-scoped on and off.
- `test/cli-watch.test.ts` — `watch <id>`.
- `test/cli-toggle-web.test.ts` — doctor now removes rather than suggests.

New coverage:

- Two sessions in one directory receive only their own reviews.
- Two clients on one session both receive a review, and the first verdict completes it.
- The losing client receives `cancel` after another client answers.
- `connect` with no TTY exits 1 and names `sessions`.
- A session with no watcher falls through to a directory watcher.
- A session with no watcher and no directory watcher fails open.
- `pair on` in session A does not enable session B in the same checkout.
- A bare `off` under a live directory flag silences this session and spares the others.
- A bare `off` never clears the directory flag.
- `on` after a bare `off` removes the opt-out and restores holding.
- A subagent edit, carrying the parent `session_id`, reaches the parent's watcher.
- The sweep removes a dead socket with its sidecar, and spares a live one.
- `sessions` reports the client count from a real second attach.

## Delivery

Two pull requests.

**PR 1, keying.** State, adapters, run, client, toggle, watch, web. This makes concurrent
sessions work. It ships alone and is useful alone.

**PR 2, broadcast.** The dispatch change, the queue change, and the cancel path. This one
carries its own risk, so it ships apart from the keying.

**PR 3, ergonomics.** The `sessions` listing, `connect`, the sidecar, the `status` frame,
the sweep, and doctor.

## Open questions

None outstanding.
