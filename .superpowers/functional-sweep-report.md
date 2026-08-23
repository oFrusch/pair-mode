# Functional sweep report

## Part 1 — bug fixes

- `src/adapters/codex.ts` — `extractPatchText` now returns `command.find(hasPatchMarker) ?? null`
  instead of a bare `.find()`, so a `Record<string, unknown>` array with no marker returns `null`,
  not `undefined`. Hoisted the duplicated `"*** Begin Patch"` literal into `BEGIN_PATCH` and reused
  it in `extractSection`'s `beginIndex` search. Added
  `extractPatchText returns null for a command array whose elements contain no marker` to
  `test/adapter-codex.test.ts`. I exported `extractPatchText` for the test.
- `src/adapters/pi.ts` — `toSimulateCall`'s `edit` case now does
  `if (!editsValue.every(isEditItemInput)) return null;` before mapping. This restores
  all-or-nothing behaviour. The `.filter` version silently dropped malformed items and simulated a
  partial edit. Added braces around both `switch` cases. The `write` case had the same
  lexical-declaration hazard. Also double-quoted the case labels to match file style. Added
  `an edit tool call with one malformed item drops the whole call, not just that item` to
  `test/adapter-pi.test.ts`.

## Part 2 — sweep, by file

- `src/core/diff.ts` — `fold`'s inner `for (near = start; near < end...) keep[near] = true` replaced
  with `keep.fill(true, start, end)`. Also fixed a pre-existing `oxlint` `no-new-array` violation on
  the same line: `new Array<boolean>(n).fill(false)` became
  `Array.from<boolean>({ length: n }).fill(false)`. I was already touching that line and the
  violation blocked `pnpm lint`.
- `src/core/collect.ts` — `anchor` now uses `numbers.slice(0, index + 1).findLastIndex(...)` instead
  of a manual reverse walk. I added `?? null` for `noUncheckedIndexedAccess`. `collect` is now
  `opcodes(...).filter(...).flatMap(...)`, building the per-opcode question range with
  `Array.from({ length }, ...)`. `formatQuestions` is now `questions.flatMap(...)`, producing 0–1
  "line" lines plus the Q line and blank line per question.
- `src/adapters/codex.ts` — `parseAddFile` is now `body.every(...)` to validate, then `body.map(...)`
  to transform. `hunkToEdit` classifies each line through a new pure `classifyHunkLine` function. It
  returns `HunkLine | null`; I added `HunkLine` to `codex.types.ts` since it is a named type. Then
  `classified.every(predicate)` runs the all-or-nothing check and two `flatMap`s build
  `oldLines`/`newLines` without an `as` cast. The hunks-to-edits loop in `parseUpdateFile` is now
  `hunks.map(hunkToEdit)` plus `edits.every(predicate)`.
- `src/core/render.ts` — `renderInline`'s row loop is now `rows.flatMap(...)`, producing 0–2 entries
  per row. Two `.map()` passes then extract `lines`/`numbers` from the flattened entries.
- `src/core/simulate.ts` — the edits-application loop in `simulate` is now
  `edits.reduce<string | null>(...)`. It threads `null` forward once any edit is invalid or fails to
  apply. This short-circuits by staying `null`, not by breaking early, so later edits are cheap to
  skip. `replaceAllEmptyOld`'s char loop is now `Array.from(text, (char) => char + next).join("")`.
- `src/core/run.ts` — `applyEnv`'s two `for` loops built a snapshot and later restored it. They are
  now `new Map(entries.map(...))` for the snapshot and `.forEach` for applying and restoring. Both
  `.forEach` calls perform a genuine side effect: mutating `process.env`.
- `src/editors/vim.ts` — the `-c` flag-pair loop is now
  `launchCommands(context).flatMap((command) => ["-c", command])`.
- `src/editors/index.ts` — the `available()` search loop is now
  `candidates(resolvesOnPath).find((c) => c.available()) ?? vimEditor("vim", resolvesOnPath)`.
- `src/cli/register.ts` — `findMultiEditMatchers`'s loop is now
  `groups.flatMap((group) => ... ? [group.matcher] : [])`.
- `src/cli/setup.ts` — the three plain `console.log` loops printed CLIs, multiplexers, editors, and
  changed files. They are now `.forEach(...)`. These are genuine side effects, not array-building,
  so this is not the `forEach`-plus-`push` anti-pattern the instructions call out.
- `src/core/config.ts` — 0 loops, as the assignment noted. I left this file untouched: every
  `errors.push(...)` call is a single-shot conditional append inside a `validateX` guard clause, not
  loop accumulation. There is no loop to convert.
- `src/cli/doctor.ts` — 0 loops, as the assignment noted. The three `.push()` calls follow the same
  single-shot conditional-append pattern as `config.ts`: `problems.push` fires twice and
  `checks.push` fires once. I left this file untouched.

## Loops kept, and why

- `src/core/diff.ts` `opcodes` — a `while` cursor over `diffArrays()` chunks that looks ahead one
  element and advances by 1 or 2 depending on whether the current and next chunk pair up into a
  `replace`. A `reduce` here would need to thread both the accumulator array and a skip-ahead
  flag or index. That is the same "mutable accumulator plus an index" shape the assignment calls out
  for `fold`. I kept this as a loop.
- `src/core/diff.ts` `align` — the assignment names this as a keep: it emits a variable number of
  rows per opcode through a nested `for`. I kept it as-is, except for the `Array.from`/lint fix noted
  above.
- `src/core/diff.ts` `fold`'s outer `while (index < rows.length)` cursor — the assignment names this
  as a keep: it walks runs of rows with an index cursor. I kept it. I converted only the trivial
  inner `keep[near] = true` loop, to `.fill`.
- `src/core/state.ts` `isEnabled` — the assignment names this as a keep: it walks up the filesystem
  until the path stops changing. I kept it as-is.
- `src/editors/syntax-cache.ts` `defaultAssetsDir` — this has the exact same shape as `isEnabled`: a
  `while (true)` loop walking up directories until `dirname(dir) === dir`. I kept it for the same
  reason, though the assignment does not name it explicitly.
- `src/adapters/codex.ts` `parseUpdateFile`'s hunk-grouping loop splits `body` into hunks on `"@@"`
  lines, growing the current hunk through a mutable `current` reference. This is a delimiter-based
  grouping walk, the same family as `fold`'s row-cursor walk. A functional version needs precomputed
  `"@@"` boundary indices and slicing to reconstruct the same runs. That reads no more clearly and
  risks an off-by-one error: an implicit leading hunk exists when `body[0]` is not itself `"@@"`. I
  kept this as a loop. I converted only the two smaller pieces around it: `parseAddFile`,
  `hunkToEdit`, and the hunks-to-edits step.
- `src/cli/register.ts` `correctMultiEditMatchers` — for each group, this needs to produce three
  outputs from one pass. It needs the replacement `next` list, which holds unchanged groups, mutated
  groups, or drops a group entirely. It also needs the `droppedMatchers` list and a `changed` flag.
  The "drop from `next`" and "mutate `group.matcher`" cases also mutate objects that live inside
  `root` in place, so a purely non-mutating rewrite would have to rebuild the whole
  `hooks.PreToolUse` subtree. I tried a `flatMap`-plus-`find`-by-identity version and it came out
  strictly worse: it re-scans the affected list per group and reads less clearly than the original
  loop. I kept the loop as-is.
- `src/cli/setup.ts` — the `for (const name of selectedClis)` loop that registers each selected CLI
  is `async` and runs sequential, ordered `await prompter.question(...)` calls and `console.log`
  calls per CLI. For example, the Codex branch prompts to fix MultiEdit matchers before it registers.
  `forEach`/`map` cannot `await` in order without `Promise.all`-style concurrency, which would
  interleave the prompts. I kept this as a `for...of` loop.

## Verification

- `pnpm test` — 18 files, 154 tests passed. That is 152 existing tests plus 2 new tests from Part 1.
- `pnpm typecheck` — clean.
- `pnpm build` — all 5 entry points built.
- `pnpm lint` (oxlint) — clean. I also fixed one pre-existing `no-new-array` violation on a line I
  was already touching in `diff.ts`.
- I added no `as` casts and no multi-line comments. All new or moved named types live in
  `<module>.types.ts`, including the new `HunkLine` type.

## Files changed

- `src/adapters/codex.ts`
- `src/adapters/codex.types.ts`
- `src/adapters/pi.ts`
- `src/core/diff.ts`
- `src/core/collect.ts`
- `src/core/render.ts`
- `src/core/simulate.ts`
- `src/core/run.ts`
- `src/editors/vim.ts`
- `src/editors/index.ts`
- `src/cli/register.ts`
- `src/cli/setup.ts`
- `test/adapter-codex.test.ts`
- `test/adapter-pi.test.ts`
