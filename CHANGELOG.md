# Changelog

All notable changes to this project appear in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

1. Bump the version in `package.json`.
2. Move the `[Unreleased]` entries into a new version section in this file.
3. Commit the version bump and the changelog.
4. Tag the commit as `v<version>`.
5. Push the commit and the tag.
6. Run `npm publish`. The `prepublishOnly` script builds `dist` for you.
