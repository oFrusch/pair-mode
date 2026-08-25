# Session modes

Two new ways to review an edit, beside the existing pane mode. Both are pure TypeScript on
the Node standard library. No new dependencies.

## The problem pane mode has

Pane mode spawns an editor inside zellij or tmux and blocks until the pane closes. This
requires a multiplexer, because Claude Code and Codex run hooks with no controlling
terminal. `/dev/tty` returns `ENXIO` there. A user without a multiplexer cannot use pair
mode at all.

## The answer

Move the review out of the agent's process. The agent posts a review request to a server
and waits for a verdict. A client the user already owns renders the review and sends the
verdict back.

Two clients:

- **Watch mode.** The user runs `pair-mode watch` in any terminal. That terminal is a real
  TTY the user started, so the multiplexer requirement disappears.
- **Web mode.** The user opens a link in a browser. No terminal at all.

Both clients speak to the same server over the same wire format. Build the server once.

## Architecture

### The transport seam

`runPair` in `src/core/run/run.ts` does three things today: it renders the diff, it runs an
editor through a multiplexer, and it reads a result file. The middle step is the only part
that changes per mode.

Introduce a `ReviewTransport` interface in a new `src/transports/` directory.

```
interface ReviewTransport {
  name: TransportName;
  review(request: EditRequest, config: PairConfig): Promise<ReviewOutcome>;
}
```

`TransportName` is a named alias in `src/core/config/types.ts`, beside the existing
`EditorName` and `MultiplexerName`. The interface never spells the union inline.

`EditRequest` carries `tool`, `filePath`, `before`, and `after`. The codebase already uses
that name, so the transport layer keeps it rather than coining a synonym. `ReviewOutcome` carries
`Question[]` plus a `reviewed` flag and an optional failure detail. `Question` already
exists in `src/core/collect/types.ts` and does not change. The wire payload does not shift.

The pane transport wraps every line of the current editor and multiplexer path. This
refactor changes no behaviour, and the existing tests prove it.

### The server lives in the client

The watcher process binds the socket. There is no separate daemon.

This removes a whole class of problems. No daemon lifecycle, no orphan process, no
`pair-mode daemon stop`, no stale process holding a port. If the watcher dies, the socket
goes away, and every hook fails open at once.

Web mode uses the same process with an extra flag. The user starts it through
`pair-mode on --web`, which detaches the process and prints the link. A web server needs no
TTY, so an agent can start it through a slash command.

### Why a socket and not an MCP server

An MCP server is the wrong shape for this, for four reasons.

1. An MCP tool is something the model chooses to call. Pair mode intercepts a write the
   model already decided to make. A voluntary call defeats the interception.
2. The hook is a short-lived subprocess. It cannot host an MCP server.
3. MCP scopes a server to one agent session. Two agents in two panes would get two servers,
   and the shared queue dies.
4. The four hook contracts already work today. A socket reuses them without change.

MCP fits later as a _client_, so a second agent can read the queue and answer a review.
That is not v1.

### The socket

A Unix domain socket at `<stateDir>/sessions/<digest>.sock`. The digest is the same sha1
prefix that `flagPath` in `src/core/state/state.ts` already computes from the real
directory path.

This choice matters. `pair-mode watch` with no argument attaches to the session for the
current directory, because both sides derive the same digest from the same path. The user
never types a session id. Never key the session on a PID: a PID is not stable, and the user
cannot guess it.

Node's `net` module provides both ends. Zero dependencies.

### The wire format

Newline-delimited JSON, one message per line. All message types live in
`src/transports/session/wire.types.ts`.

| Message   | Direction        | Payload                                 |
| --------- | ---------------- | --------------------------------------- |
| `attach`  | client to server | `client: "tui" \| "web"`                |
| `review`  | server to client | `id`, `tool`, `path`, `before`, `after` |
| `verdict` | client to server | `id`, `questions`                       |
| `cancel`  | server to client | `id`                                    |

The agent side connects, writes one `review`, and waits for the matching `verdict`.

### The queue

The server holds a FIFO of pending reviews. Each review carries a generated id.

A queue is required, not optional. Two agents can run in two panes against the same repo,
and a single agent can issue a second edit while the user still reviews the first. The
client pulls one review at a time and answers each by id.

### Failure paths

The agent must never hang forever. Three cases:

1. **No socket file.** No watcher exists. Fail open at once, with `reviewed: false`.
2. **A socket file that refuses a connection.** The watcher died without cleanup. Unlink
   the stale socket, then fail open.
3. **A connected server that never answers.** Apply `session.timeout`, default 300
   seconds. On expiry, fail open and report the timeout in the verdict detail.

Fail open means the edit applies. This matches the current rule that a clean quit with no
notes applies the edit.

## Watch mode

`pair-mode watch [directory]`.

The watcher owns a real TTY, so it runs the existing TUI directly. `runTui` in
`src/tui/index.ts` already takes a `TuiOptions` and a `TuiIo`, and it already returns notes.
The watcher builds `TuiOptions` from the `review` message and calls it.

The TUI needs one change: today `src/tui/cli.ts` runs one review and exits the process. The
watcher instead loops. Between reviews it paints a waiting screen that names the directory
and the queue depth.

Nothing in `paint`, `model`, `notes`, or `selection` changes.

### Idle screen

The waiting screen shows the session directory, the attached client count, and the pending
queue depth. `q` quits the watcher and releases the socket.

## Web mode

The same watcher process binds an HTTP server when the user passes `--web`.

The server binds `127.0.0.1` only. It never listens on a public interface. A random 32
character hex token forms the URL path. The server prints the token once and never logs it.

| Route                     | Purpose                                   |
| ------------------------- | ----------------------------------------- |
| `GET /r/<token>`          | the review page                           |
| `GET /r/<token>/events`   | server-sent events, one per queued review |
| `POST /r/<token>/verdict` | the questions for one review id           |

A request with a wrong token returns 404, never 403. A 403 confirms the token space.

### How the page renders

The web page renders the diff model as HTML. It does not render ANSI.

`src/tui/model/model.ts` is pure and produces the aligned rows, the fold rows, and the line
numbers. The web client consumes that model and emits a table. Selection maps to DOM
ranges, and a note maps to a row range, exactly as the TUI does.

Syntax colour comes from the same `shiki` provider the TUI uses. `src/tui/syntax` already
returns tokens with a start, an end, and a colour, so the web client wraps each token in a
span.

### No web framework

Plain HTML, CSS, and DOM code. No React.

The page is one table, one selection, and one note panel. React would cost a second bundler
pass and about 45kb, to render a model once per review.

Two things would justify a framework later: a multi-file review in one page, or a live queue
view. Both carry real client state. Neither is in v1.

The page ships as one bundled HTML string inside `dist`. No framework, no build step beyond
the existing esbuild pass, no external asset. This keeps the npm package one runnable file
per entry point, which is the rule the project already follows.

## Configuration

Three fields join `PairConfig` in `src/core/config/types.ts`.

```
transport   TransportName            default "pane"
session     { timeout: number }      default { timeout: 300 }
web         { enabled: boolean, port: number }   default { enabled: false, port: 0 }
```

A port of `0` asks the operating system for a free port. The chosen port appears in the
printed link.

`pair-mode on --web` sets `web.enabled`, spawns the detached server, and prints the link.
`pair-mode off` stops the server and unlinks the socket.

## Doctor

`pair-mode doctor` gains three checks:

1. Whether a session socket exists for the current directory.
2. Whether that socket accepts a connection.
3. Whether a web server answers on the recorded port.

A stale socket becomes a reported fault with the exact unlink command.

## Phases

Each phase ends with all four gates green: `vitest run`, `tsc --noEmit`, `oxlint`, and
`oxfmt --check`.

### Phase 1: the transport seam

Extract `ReviewTransport`. Move the current editor and multiplexer path into
`src/transports/pane/`. `runPair` selects a transport from `config.transport`.

Verification: every existing test passes unchanged. This is the whole point of the phase.

### Phase 2: the session server

Build the socket server, the queue, and the wire codec in `src/transports/session/`.

Verification: unit tests drive both ends in one process over a temporary socket. Assert the
queue order, the id matching, and the client disconnect path.

### Phase 3: the session transport

Build the agent side. Connect, post, wait, time out, clean up a stale socket, fail open.

Verification: an offline test starts a fake server that answers, one that never answers, and
one that dies mid-review. Assert the verdict in each case.

### Phase 4: watch mode

Build `pair-mode watch`. Loop the TUI over the queue. Add the idle screen.

Verification: run the real bundle in a live zellij pane, drive input with
`zellij action write-chars`, and read the screen with `dump-screen --ansi`. This method
already caught defects that unit tests missed.

### Phase 5: web mode

Build the HTTP server, the event stream, and the HTML client.

Verification: drive the page with the Chrome DevTools MCP server. Assert that a selection
plus a note produces the correct question payload on the wire.

### Phase 6: configuration, doctor, and docs

Add the config fields, the doctor checks, the `--web` flag, and the README section.

## Known limits

- One review at a time per client. A user cannot answer review 2 before review 1.
- Web mode gives no protection against another local user on the same machine. The token
  sits in the URL, and a local user can read the process list. Document this.
- Watch mode needs the user to start the watcher before the agent edits. A missing watcher
  fails open, so an unattended agent applies its edits.
- Server-sent events do not survive a laptop sleep. The page must reconnect.
