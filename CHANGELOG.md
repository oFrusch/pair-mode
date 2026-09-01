# Changelog

All notable changes to this project appear in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `pair-mode toggle` reads the current state and moves to the other one.
- Language detection reads the extension, then the exact filename, then the shebang. `Gemfile`, `Dockerfile`, `Makefile`, and an extensionless script now get colour.
- `pnpm run syntax` fetches the micro syntax assets.

### Changed

- The plugin ships one `toggle` skill. It replaces two entries that both registered as `pair`.
- Shiki now colours every language it bundles, not only the 22 that ship a micro asset.
- The repo ships 54 micro syntax assets, up from 22.

### Fixed

- `.erb` renders as ERB, not as plain HTML.

### Removed

- Node 20 support. That release went end of life on 2026-04-30, and pnpm 11 no longer runs on it.

## [0.3.0] - 2026-08-26

### Changed

- The release script stamps the new version into every plugin manifest.
- The release gates validate the plugin manifests.

### Added

- Pair mode ships as a Claude Code plugin and as a Codex plugin.
- The repo hosts its own plugin marketplace for both CLIs.
- A `pair` skill ships in the package, so a skill index can find it.

## [0.2.1] - 2026-08-26

### Added

- The web page serves a duck favicon, and it marks its header with the duck.
- The web page shows the duck while it waits for an edit.
- The watch idle screen draws a duck.

## [0.2.0] - 2026-08-26

### Added

- The web review renders an inline layout and a split layout, and `u` swaps them.
- The inline layout puts every note in the right margin and draws a leader to the line it covers.
- The split layout threads every note under the last line it covers.
- The web page opens in the layout the `layout` setting names.

### Changed

- The web page replaces the docked notes panel and the full-width amber bar with a path line and a status line.
- A split row with no line on one side renders as hatched padding instead of blank space.

## [0.1.1] - 2026-08-26

### Added

- `pnpm release patch|minor|major` runs the gates, bumps the version, rolls the changelog, tags, publishes, and pushes.
- The README shows a screenshot of each review mode.

### Fixed

- The README names the correct micro save key, which is Ctrl+W.

## [0.1.0] - 2026-08-26

First public release.

### Added

- Pair mode reviews a coding agent's proposed edits before the agent applies them.
- The `pair-mode` CLI provides `setup`, `doctor`, `on`, `off`, `status`, `config`, and `watch`.
- Agent adapters cover Claude Code and Codex. The opencode and pi adapters ship in 1.0.0.
- The Claude Code adapter auto-approves an edit after you review it.
- The diff engine aligns opcodes and folds unchanged regions.
- The collect module turns a saved buffer diff into anchored questions.
- A result-file reporting path runs alongside the buffer-diff path.
- The built-in TUI review pane paints a split or unified diff, and it tracks the live terminal size.
- The TUI pane accepts key input, mouse drag selection, and wheel scrolling.
- The TUI pane docks a notes panel, and it anchors every note to a selected row.
- Shiki supplies syntax tokens to the TUI pane, with a per-line cache.
- Editor adapters cover micro, vim, nvim, nano, and the built-in pair pane.
- Multiplexer adapters cover zellij, tmux, and a plain tty.
- Session modes add a socket transport, a review queue, and a wire codec.
- The browser review client serves a review over `pair-mode watch --web`.
- The build emits `dist/cli.js`, `dist/pair-tui.js`, and one bundle per adapter.

### Fixed

- Codex accepts the deny verdict, because the adapter now sends `hookEventName`.
- The web client drops a cancelled review, and it refuses a verdict that does not name the open review.
- The CLI keeps one backup file and one hook entry per file.
- The Codex adapter reads a patch that ends at the end of the file.
- The transports track every socket, and the tmux channel stays unique.
- The TUI counts screen lines when it scrolls, not model rows.

## Releasing

Run one command from a clean `main`:

```
pnpm release patch     # or minor, or major
```

The script refuses to run unless the branch is `main`, the tree is clean, and `HEAD`
matches `origin/main`. It then runs the typecheck, the lint, the format check, the tests,
and the build. It bumps the version, moves the `[Unreleased]` entries into a dated
section, commits, tags `v<version>`, publishes to npm, and pushes the commit and the tag.

The script also stamps the new version into every plugin manifest, and it runs
`claude plugin validate . --strict` as a gate. A machine without Claude Code skips that
one check and still cuts the release.

The script publishes before it pushes. A failed publish therefore leaves the remote
untouched, and `git tag -d v<version> && git reset --hard HEAD~1` undoes the local state.

Add `--dry-run` to stop after the tag and before the publish.
