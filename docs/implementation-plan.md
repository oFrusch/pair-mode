# pair-mode implementation plan

The design plan lives at `~/.claude/plans/hashed-bubbling-catmull.md`. This document turns
that design into ordered work. Each task names the files it touches and the check that
closes it.

The reference implementation is `/Users/owen/dev/claude-config/hooks/pair-mode.py`, 540
lines, plus `pair-toggle.py`. Treat the Python as the specification for phase 1 behaviour.

## Ground rules

- One term per concept across code, tests, and docs. The list is: pane, band, fold, anchor,
  question, adapter, flag file.
- Types live in `<module>.types.ts`. No type-coercion `as` casts.
- Every phase ends green: `pnpm typecheck`, `pnpm test`, and the phase check below.
- Commit per task. Branch `feat/pair-mode-core/pm-1` and onward, one branch per phase.

## Phase 0 — scaffold (done)

`package.json`, `tsconfig.json`, `pnpm-workspace.yaml`, and the `src/` tree exist. The
lockfile pins `diff` 8, `esbuild` 0.25, `typescript` 5.9, `vitest` 3.

Remaining work in this phase:

1. Add `scripts/build.mjs`. esbuild bundles five entry points to `dist/`: `cli.js`,
   `claude-code.js`, `codex.js`, `opencode.js`, `pi.js`. Target `node20`, format `esm`,
   platform `node`, bundle every dependency.
2. Add `vitest.config.ts` with `test.include` set to `test/**/*.test.ts`.
3. Commit the scaffold on `main`.

Check: `pnpm build` writes five files under `dist/`.

## Phase 1 — core

The core is pure. No module in `src/core/` may import `node:child_process` or `node:fs`
except `config.ts` and `state.ts`.

### 1.1 `src/core/types.ts`

Declare the shared shapes:

- `Row` — `{ left: string, right: string, kind: "same" | "change" | "fold", number: number | null }`.
- `RenderResult` — `{ text: string, numbers: (number | null)[], originalRight: string[] }`.
- `Question` — `{ line: number, code: string, text: string }`.
- `PairConfig` — the config file shape from the design plan.
- `HookRequest` — `{ tool: string, filePath: string, before: string, after: string }`.
- `HookVerdict` — `{ decision: "allow" } | { decision: "deny", reason: string }`.

### 1.2 `src/core/diff.ts`

1. Wrap `diffLines` from `jsdiff` in `opcodes(before, after)`. Return the tuple list
   `{ tag, i1, i2, j1, j2 }` where `tag` is `equal`, `insert`, `delete`, or `replace`.
2. Pair each adjacent removed chunk and added chunk into one `replace` opcode. `jsdiff`
   emits them separately. The alignment depends on the pairing.
3. Write `align(before, after)`. Return `Row[]` with equal row counts on both sides. A
   padding row holds the empty string.
4. Write `fold(rows, context, minFold)`. Mark `context` rows either side of every change.
   Collapse any remaining run of `minFold` or more rows into one fold row that reads
   `⋯ N unchanged lines`.

### 1.3 `src/core/render.ts`

1. Port the header text and the markers. The left marker is `▌▌- `, the right marker is
   `▌▌+ `, and an unchanged row carries four spaces.
2. Emit two buffer files, one per pane, plus the `numbers` array that maps each right-pane
   row to a line number in the edited file.
3. Support the `inline` layout as a second render function. The prototype shipped it.

### 1.4 `src/core/collect.ts`

1. Diff the saved right pane against the original right pane.
2. Treat every inserted line and every replaced line as a question.
3. Anchor each question to the nearest code row above it. Return `Question[]`.
4. Skip blank lines.

### 1.5 `src/core/config.ts`

1. Read `~/.config/pair-mode/config.json`. Return the defaults when the file is absent.
2. Validate every field with a hand-written type guard. Reject an unknown editor name.
3. Report a validation failure as a list of field paths, not a thrown error.

### 1.6 `src/core/state.ts`

1. Key the flag file by `sha1(realpath(dir)).slice(0, 16)` under
   `~/.local/state/pair-mode/`.
2. Walk up from the edited file to the filesystem root. A flag at a repo root covers every
   file beneath it.

### 1.7 Tests

Generate fixtures from the Python prototype first. Add `scripts/capture-fixtures.mjs` that
runs the Python renderer over the `pair-demo` files and writes the expected buffers to
`test/fixtures/`.

Cover these cases:

1. A single-line change in a 10-line file.
2. Two hunks 65 lines apart in a 124-line file. The prototype renders 32 rows with three
   fold rows. Assert that count.
3. A pure insertion at the top of a file.
4. A pure deletion at the end of a file.
5. A question typed on a fold row. The anchor must resolve to the code row above.
6. A saved buffer with no changes. `collect` returns an empty list.

Check: `pnpm test` passes, and every fixture matches the Python output byte for byte.

## Phase 2 — Claude Code, micro, zellij, tmux

### 2.1 `src/multiplexers/`

1. `zellij.ts` runs `zellij run --floating --close-on-exit --blocking --width --height --
   argv`. `--blocking` waits for the pane to close.
2. `tmux.ts` runs `tmux display-popup -E`. The popup returns immediately, so append
   `tmux wait-for -S <channel>` to the inner command. The adapter then waits on
   `tmux wait-for <channel>`.
3. `tty.ts` opens `/dev/tty`. Claude Code gives a hook no controlling terminal, so this
   path raises `ENXIO` there. Report the failure by name.
4. `index.ts` detects in this order: `$ZELLIJ`, `$TMUX`, tty.

### 2.2 `src/editors/micro.ts`

1. Generate a private config under `MICRO_CONFIG_HOME`. Never touch the user's own micro
   config.
2. Fetch the upstream syntax file for the source language. Cache it under `assets/syntax/`.
3. Append the band rules as **regions**, with `start` and `end: "$"`. A plain rule loses the
   row to micro's own string regions, and the band then stops mid-line.
4. Order the rules with the language rules first and the band regions last.
5. Bind `Ctrl-W` and `F2` to `QuitAll` only. micro stops a binding chain at the first action
   that succeeds, so `SaveAll,QuitAll` never quits. Set `autosave` to 1 instead.
6. Avoid the keys zellij owns: Ctrl plus g, p, t, n, h, s, o, or q.
7. Open the two panes with `-multiopen vsplit`.

### 2.3 `src/adapters/claude-code.ts`

1. Read the JSON payload from stdin. Map `tool_input` to `HookRequest` for `Write`, `Edit`,
   and `MultiEdit`.
2. Simulate the edit to produce the `after` text. `Write` supplies it directly.
3. Exit 0 when the flag file is absent for the edited path.
4. Exit 2 with the questions on stderr when the user typed any. Exit 0 otherwise.

### 2.4 The offline harness

Add `test/harness.test.ts`. Point `CC_PAIR_EDITOR` at a script that appends a question to
the right pane. Feed a hook payload on stdin. Assert exit code 2 and the exact stderr. This
harness exposed real bugs in the prototype.

Check: dogfood pair-mode on this repo with the Python hook turned off. Every prototype
behaviour survives.

## Phase 3 — vim, nvim, nano

1. `src/editors/vim.ts` serves vim and nvim. Pass `-c "hi PairAdd guibg=..."` and
   `-c "call matchadd('PairAdd', '^▌▌+')"`, then the same pair for delete and fold.
2. Set `filetype` from the source extension so syntax loads.
3. Add no key bindings. `:wq` already works.
4. `src/editors/nano.ts` writes a generated nanorc with band colours only. nano gives no
   syntax highlighting here. Say so in the README.

`matchadd` overlays a highlight on top of syntax. A changed row in vim keeps its syntax
colours and gains a band. micro cannot do both, because micro paints one group per
character.

Check: the manual matrix. Each editor crossed with zellij and tmux. The pane opens, the band
renders, the fold renders, one keypress saves and quits, and the questions carry correct line
numbers.

## Phase 4 — setup and doctor

### 4.1 `src/cli/setup.ts`

1. Detect the installed CLIs, the multiplexers on `PATH`, and the editors on `PATH`.
2. Ask for the editor, the multiplexer, and the layout. Default to what the machine has.
3. If the machine has no multiplexer, and the user selects Claude Code or Codex, warn before
   any write. pair-mode cannot open an editor there.
4. Write the config file.
5. Register the hook per CLI. Back up each file first.
   - Claude Code: `~/.claude/settings.json`, `PreToolUse`, matcher `Write|Edit|MultiEdit`,
     timeout 1800. Claude Code loads hooks at startup, so tell the user to restart.
   - Codex: `~/.codex/hooks.json`, matcher `apply_patch|Edit|Write`. Codex has no `MultiEdit`
     alias, and that token matches nothing. The user's current `~/.codex/hooks.json` carries
     this bug today.
   - opencode: `~/.config/opencode/plugin/pair-mode.ts` re-exports the adapter.
   - pi: `~/.pi/agent/extensions/pair-mode.ts`.
6. Print every file the command changed.
7. Run the doctor self-test.

A second run of `setup` must produce the same result as the first.

### 4.2 `src/cli/doctor.ts`

Report config validity, editor presence, multiplexer presence, hook registration per CLI,
the presence of a controlling terminal, and the last ten trace lines.

### 4.3 `src/cli/toggle.ts`

Port `pair-toggle.py`. Accept `on`, `off`, and `status`.

Check: `pnpm build`, then `node dist/cli.js setup` on a scratch `HOME`. The registrations
land, and `doctor` reports green.

## Phase 5 — Codex

`src/adapters/codex.ts` translates the payload and formats the deny response as
`hookSpecificOutput.permissionDecision: "deny"` with `permissionDecisionReason`. Exit 2 also
works. The work is roughly 30 lines on top of the Claude Code adapter.

Check: a live end-to-end run in `codex`. Enable, request an edit, annotate, and confirm the
model receives the questions.

## Phase 6 — opencode and pi

1. `src/adapters/opencode.ts` exports the plugin. The `tool.execute.before` hook throws an
   `Error` whose message reaches the model as `errorText`.
2. `src/adapters/pi.ts` exports the extension. The `tool_call` hook returns
   `{ block: true, reason }`.

`pi` is installed on this machine, so phase 6 gets a live test for pi. `opencode` is absent.
Its adapter ships with unit tests only, and the README marks it untested.

Check: a live end-to-end run in `pi`, and unit tests for the opencode contract.

## Phase 7 — release

1. Write the README. Cover the install path `npx pair-mode setup`, the per-editor matrix,
   and the known limits.
2. Publish `pair-mode` to npm.
3. Delete `pair-mode.py` and `pair-toggle.py` from `claude-config`. Replace the
   `~/.claude/settings.json` entry with the published hook.

## Risks

- **jsdiff opcode pairing.** `diffLines` splits a replacement into a removal and an addition.
  A wrong pairing shifts every line number. The fixture tests catch it.
- **micro syntax fetch at runtime.** The prototype fetched from GitHub. Ship the cached files
  as assets so setup needs no network.
- **Claude Code hook reload.** A user who edits settings without a restart sees nothing
  happen. `doctor` must state whether the running session predates the registration.
- **opencode contract drift.** No local install exists to verify against.

## Out of scope for v1

- One pane per changeset instead of one per Edit call.
- `bun build --compile` for a standalone binary.
- A choice added to the Claude Code permission menu. No extension surface exists.
