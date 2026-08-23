# YAML serializer refactor report

## Task 1 — micro syntax through `yaml`

- `src/editors/micro.ts` now parses `assets/syntax/<lang>.yaml` with `yaml`'s `parse`, builds a
  `MicroSyntaxFile` object (`filetype`, `detect.filename`, `rules`), appends the four band
  rules as objects (`pairadd`, `pairdel`, `pairskip`, `comment`, in that order, last in the
  array, each a region with `start`/`end: "$"`), and serializes with `stringify(file, { lineWidth: 0 })`.
- Regex values are plain JS strings with single backslashes in source. `"^▌▌\\+"` is one
  escaped backslash in source, so it holds one literal backslash character at run time. The
  serializer owns all YAML escaping.
- The refactor deletes `ruleIndent`, the `SyntaxIndent` type, and the hand-built
  `syntaxHead`/string-concat `bandRules`. `syntax-cache.ts` renames `ruleBody` (a sliced-text
  reader) to `syntaxSource` (a full-file reader), since the new code parses the whole file, not
  just the rules body.
- New `src/editors/micro.types.ts` holds `BandRegion`, `BandRule`, `MicroSyntaxSource`,
  `MicroSyntaxFile`.
- `package.json` moves `yaml` from devDependencies to dependencies.

## Task 2 audit

1. **`nano.ts`** — theme colours are hex-validated upstream in `config.ts`. No live defect
   exists today. A new local `safeThemeColor` guard uses the same hex regex, via a shared
   `src/helpers/hexColor.ts`, before interpolation into the `color ,<value> "..."` line. A
   space or comma in an unvalidated future value would shift nanorc's unquoted colour tokens,
   and the guard closes that path. The rcfile path itself is an argv element, not interpolated
   into file text, so it carries no hazard.
2. **`vim.ts`** — a new `safeThemeColor` guard runs before each `hi ... guibg=<value>` `-c`
   string, closing the `|` command-separator hole for any future caller that bypasses
   `config.ts`.
3. **micro's `bindings.json`/`settings.json`** — both already go through `JSON.stringify`.
   These files stay unchanged.

## Unrelated build bug found and fixed

The real test suite already passes 183 tests before this refactor. Stashing the changes and
rerunning `pnpm test` confirms that baseline. After this refactor, esbuild's ESM-format bundle
of anything that pulls in the `yaml` package broke at run time, because `yaml` is a CJS
library. `yaml` calls `require("process")` internally. Esbuild leaves that call as a dynamic
runtime `require()`, which does not exist in an ESM context, so it throws `Dynamic require of
"process" is not supported`. This hit the real `dist/codex.js` and `dist/claude-code.js`
builds, not only the tests. The fix adds a `createRequire` banner shim (`import {
createRequire } from "node:module"; const require = createRequire(import.meta.url);`) to
`scripts/build.mjs` and to the two adapter test files that bundle with esbuild directly.
`dist/codex.js` runs correctly after `pnpm build`, verified directly.

## Tests

- All 22 vendored languages drive `test/editors-micro-syntax-parse.test.ts` from
  `readdirSync(assetsDir)`, parsing the generated output and asserting: band rules last, in
  order, each a region with `start`/`end`; `pairadd.start === "^▌▌\\+"`; `detect.filename`
  matches the buffer suffix; and every upstream rule precedes the band rules (rules array
  length and prefix equality check).
- `test/editors-micro.test.ts` now asserts on parsed structure instead of exact text.
- `test/editors.test.ts` gained two hazard tests: a `|`-carrying theme colour throws from
  `vim.ts`, and a space-carrying theme colour throws from `nano.ts`.
- 185 tests pass: 183 prior plus 2 new hazard tests. `pnpm typecheck`, `pnpm build`, and
  `oxlint` all report clean.

## Concerns

None outstanding. The esbuild/ESM/CJS interop bug was a real defect independent of this
refactor's ask. This refactor introduced `yaml` as a bundled runtime dependency, which
exercised the code path that exposed the bug. The fix is in place and covered by the existing
adapter subprocess tests.
