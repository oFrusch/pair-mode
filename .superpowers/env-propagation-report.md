# Editor env propagation fix

## Bug

`src/core/run/run.ts` applied editor env, such as `MICRO_CONFIG_HOME`, by
mutating `process.env` around the multiplexer call, via a helper named
`applyEnv`. Both `zellij run` and `tmux display-popup` hand the command to a
server process. That server process spawns the command in the server's own
environment, so `process.env` in the hook process never reaches the spawned
editor. Micro loaded the user's real config instead of the private one. The
private config is the only place `CtrlW` binds to `QuitAll`, so the user could
not close the pane.

## Fix

- Added `withEnvPrefix(argv, env)` in `src/core/run/run.ts`. When `env` has
  entries, it returns `["env", "KEY=VALUE", ..., ...argv]`. When `env` is
  empty, it returns `argv` unchanged. It builds once, before the multiplexer
  call, so every multiplexer gets the same argv. That covers zellij, tmux,
  and tty.
- Deleted `applyEnv` and its `process.env` mutate/restore call. Nothing else
  used it.
- Added `RunDeps` in `src/core/run/types.ts` with an optional `multiplexer`
  field, so `runPair(request, config, deps?)` can take an injected
  multiplexer for tests. Default behavior stays `detect(config.multiplexer)`
  for existing callers, which pass no third argument.
- `run.ts` still names no specific CLI or editor. `withEnvPrefix` is generic
  over any `env` map.

## Tests

- `test/run.test.ts` is a new file. It checks that `runPair` builds
  `["env", "MICRO_CONFIG_HOME=...", "micro", ...]` when the real micro editor
  adapter returns a non-empty env. It checks that `runPair` builds argv with
  no `env` prefix for a passthrough editor with an empty env. Both cases
  inject a recording `Multiplexer` so nothing real spawns. `HOME` and
  `XDG_STATE_HOME` point at temp dirs.
- `test/multiplexers.test.ts` gained a case confirming tmux's shell quoting
  wraps a `KEY=VALUE` argv element in single quotes when the value has a
  space.
- The full suite passed 160 tests: 157 existing plus 3 new. Typecheck,
  build, and oxlint all passed clean.

## Files touched

- `/Users/owen/dev/pair-mode/src/core/run/run.ts`
- `/Users/owen/dev/pair-mode/src/core/run/types.ts`
- `/Users/owen/dev/pair-mode/src/core/run/index.ts`
- `/Users/owen/dev/pair-mode/test/run.test.ts`, a new file
- `/Users/owen/dev/pair-mode/test/multiplexers.test.ts`
