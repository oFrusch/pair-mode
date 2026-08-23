# Folder restructure report

## What changed

Every logic module that owned a private `.types.ts` file became a folder:
`<module>.ts` + `<module>.types.ts` -> `<module>/<module>.ts` + `<module>/types.ts` +
`<module>/index.ts`. All moves used `git mv`. No logic changed; only import paths,
file locations, and new barrel files.

Converted:

- `src/adapters/claude-code/` — claude-code.ts and index.ts. This module owns no
  private types file.
- `src/adapters/codex/` — codex.ts, types.ts, index.ts
- `src/adapters/opencode/` — opencode.ts, types.ts, index.ts
- `src/adapters/pi/` — pi.ts, types.ts, index.ts
- `src/cli/detect/`, `src/cli/doctor/`, `src/cli/register/`, `src/cli/setup/`
- `src/core/collect/`, `src/core/config/`, `src/core/diff/`, `src/core/render/`,
  `src/core/run/`, `src/core/simulate/`, `src/core/state/`
- `src/helpers/helpers.types.ts` renamed to `src/helpers/types.ts`. The helpers
  folder already existed.

Left flat, since each owns no private types file: `src/core/marks.ts`,
`src/core/trace.ts`, `src/adapters/entry-point.ts`, `src/cli/install-root.ts`,
`src/cli/toggle.ts`, `src/cli/index.ts`.

Each `index.ts` exports only what an outside importer actually uses. I checked the
real importers in `src/`, `test/`, and `scripts/` first, then wrote an explicit
export list, never a blanket `export *`. Some types stay unexported from `index.ts`
because only their own module uses them. Examples: `ParsedPatch` and `HunkLine` in
codex, `DoctorCheck`, `DoctorOptions`, and `DoctorReport` in doctor, and every type
in `cli/detect`.

## The three judgment calls

**`src/adapters/adapter.types.ts`** — I kept it in place, unrenamed. It defines
`SimulateCall`, shared by `opencode.ts` and `pi.ts`. It already lived at the
`adapters/` parent level, one level above any single adapter's folder. That position
already reads as "shared across adapters." Moving it into one adapter's folder would
have falsely implied ownership by that adapter.

**`src/editors/editor.types.ts`** and **`src/multiplexers/multiplexer.types.ts`** —
I left both flat and unrenamed, alongside their sibling implementation files. Both
declare a shared interface that several sibling files implement. The editors
interface is `Editor`. `micro.ts`, `vim.ts`, `nano.ts`, and `index.ts` all implement
it. The multiplexers interface is `Multiplexer`. `zellij.ts`, `tmux.ts`, `tty.ts`,
and `index.ts` all implement it. A shared interface implemented by several siblings
differs from one module's private types file, so it does not fit the "logic plus own
types becomes a folder" pattern the owner asked for. A per-implementer folder would
have scattered one shared interface across four folders for no benefit, since no
single implementer owns it. I applied this answer consistently to both directories.

## Verification

- `pnpm typecheck` — 0 errors
- `pnpm test` — 154 passed, 0 failed
- `pnpm build` — all five bundles built, no skip lines
- `pnpm lint` (oxlint) — clean
- `node -e "import('./dist/opencode.js')"` and the same command for `dist/pi.js`
  both resolve with no error and no side effect
- Core purity holds. `src/core/` has no `node:child_process` import anywhere.
  `node:fs` appears only in `config/config.ts`, `state/state.ts`, `run/run.ts`, and
  `trace.ts`. Every core module imports `isRecord` from the specific helper file,
  `../../helpers/isRecord`, never from the helpers barrel.

## Notable relative-path changes

Every file that moved one level deeper had its relative imports bumped by one `../`.
Examples: `../core/state` became `../../core/state` in adapters, and
`../helpers/resolvesOnPath` became `../../helpers/resolvesOnPath` in cli/detect.
Type-only imports that used to target a sibling `.types.ts` file now mostly route
through the target module's `index.ts` barrel. For example, other modules import
`PairConfig` from `../../core/config` instead of `../../core/config.types`, because
outside consumers of the config module also need that type.

`scripts/build.mjs` entry points now point at `src/adapters/<name>/<name>.ts`
directly, not at the folder's `index.ts`. This matches how the script built the flat
files before the move.
