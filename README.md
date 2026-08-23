# pair mode

A coding agent proposes an edit. Pair mode opens a side-by-side diff in a terminal
editor. Every line you type becomes a question the model must answer, and the edit
does not apply until you close the editor.

## Install

```
npx pair-mode setup
```

The setup command detects the CLIs and multiplexers on your machine, registers the
required hooks, and writes a config file. Restart Claude Code after setup, because
Claude Code loads hooks only at startup.

If you install from git instead of npm, run `pnpm build` first. The package does not
ship a committed `dist/` directory; npm builds it fresh through the `prepublishOnly`
script, but a git checkout does not run that script.

## Supported CLIs

| CLI         | Hook                                             | Status                                                                                                                            |
| ----------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | `PreToolUse`, matcher `Write\|Edit\|MultiEdit`   | Tested                                                                                                                            |
| Codex       | `PreToolUse`, matcher `apply_patch\|Edit\|Write` | Tested                                                                                                                            |
| pi          | `tool_call` extension hook                       | Tested                                                                                                                            |
| opencode    | `tool.execute.before` plugin hook                | Untested — opencode is not installed on the author's machine. Ships against the documented plugin contract, with unit tests only. |

Codex has no `MultiEdit` matcher alias. Its `apply_patch` parser reads single-file Add,
Update, and Delete patches only. A multi-file or rename patch passes through untouched.

## Editors

| Editor        | Diff colour | Syntax colour on changed rows                                                                                |
| ------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| pair (default) | Yes        | Yes. pair is the built-in review pane, so it paints syntax colour and change colour on the same row. It also reads mouse clicks and drags for selection, and it anchors a note to the exact span you select, not the whole line. |
| micro         | Yes         | No. micro paints one highlight group per character, so a changed row trades syntax colour for the diff band. |
| vim           | Yes         | Yes. `matchadd()` overlays the diff highlight on top of syntax, so a changed row keeps both.                 |
| nvim          | Yes         | Yes. Same `matchadd()` overlay as vim.                                                                       |
| nano          | Yes         | No. nano has no syntax engine here, so a changed row gets the diff band only.                                |

Keys:

- pair: see [Keymap](#keymap) below.
- micro: Ctrl+W or F2 sends your annotations and closes the editor. F3 moves between
  panes.
- vim and nvim: `:wqa` sends your annotations and closes the editor.

## Keymap

These keys work inside the pair review pane. Some have a mouse equivalent; the rest are
keyboard only.

| Key                | Mouse equivalent | Action                                                                             |
| ------------------ | ----------------- | ----------------------------------------------------------------------------------- |
| `j` `k` `↓` `↑`     | —                 | Move the row cursor. A fold moves as one row.                                       |
| `Ctrl+d` `Ctrl+u`   | —                 | Page down and page up.                                                              |
| `n` `N`             | —                 | Jump to the next and the previous changed run.                                      |
| `v`, then a motion  | click and drag    | Select a span.                                                                      |
| `a`                 | double click      | Open a note on the current selection, or on the current row if nothing is selected. |
| `Enter`             | —                 | Save the note.                                                                      |
| `Esc`               | —                 | Discard the note draft, or clear the current selection.                             |
| `Tab`               | —                 | Cycle the focused note.                                                             |
| `d`                 | —                 | Delete the focused note.                                                            |
| `Space`             | click a fold      | Expand or collapse a fold row.                                                      |
| `u`                 | —                 | Swap between the split layout and the unified layout.                               |
| `Ctrl+s`            | —                 | Send the notes. The hook denies the edit.                                           |
| `Ctrl+q` `Ctrl+c`   | —                 | Quit. With no notes, the edit applies. With notes pending, asks: `s` sends, `d` discards and quits, `Esc` cancels. |
| `?`                 | —                 | Toggle the keymap overlay.                                                          |

zellij consumes the mouse scroll wheel, so pair mode never depends on it. `Ctrl+d` and
`Ctrl+u` page instead.

Holding `shift` during a click or drag passes the mouse event straight through to the
terminal, which then selects text for copy — the same as any other terminal program.

## Multiplexers

Claude Code and Codex run their hooks with no controlling terminal. `/dev/tty` returns
`ENXIO` there. Pair mode needs zellij or tmux to open an editor pane under those two
CLIs. pi and opencode run hooks with a controlling terminal already attached, so no
multiplexer is required for them.

## Configuration

Pair mode reads `$XDG_CONFIG_HOME/pair-mode/config.json`, or `~/.config/pair-mode/config.json`
when `XDG_CONFIG_HOME` is not set.

| Key             | Type                                                                                  | Default     | Meaning                                              |
| --------------- | -------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------- |
| `editor`        | `"auto" \| "pair" \| "micro" \| "nvim" \| "vim" \| "nano"`, or an array of editor names | `"auto"`    | Which editor opens the review pane.                    |
| `multiplexer`   | `"auto" \| "zellij" \| "tmux" \| "none"`                                                | `"auto"`    | Which multiplexer hosts the pane.                      |
| `layout`        | `"split" \| "inline"`                                                                   | `"split"`   | Side-by-side columns, or one column.                   |
| `notes`         | `"panel" \| "anchored"`                                                                 | `"panel"`   | A docked notes panel, or a note inline at its anchor.  |
| `context`       | integer, 1 or more                                                                      | `5`         | Unchanged lines kept around a change before folding.   |
| `minFold`       | integer, 1 or more                                                                      | `4`         | Minimum run of unchanged lines that folds.             |
| `pane.width`    | string                                                                                  | `"90%"`     |                                                         |
| `pane.height`   | string                                                                                  | `"90%"`     |                                                         |
| `theme.add`     | 6-digit hex colour                                                                      | `"#1e3a1e"` |                                                         |
| `theme.del`     | 6-digit hex colour                                                                      | `"#3a1e1e"` |                                                         |
| `theme.fold`    | 6-digit hex colour                                                                      | `"#2a2a2a"` |                                                         |
| `theme.rowBand` | boolean                                                                                 | `false`     | Paint the whole changed row, not just the changed span, in pair. |
| `syntax`        | boolean                                                                                 | `true`      | Load Shiki for syntax colour in pair.                  |
| `trace`         | boolean                                                                                 | `false`     |                                                         |
| `autoApprove`   | boolean                                                                                 | `true`      |                                                         |

An `editor` array lists editor names in order of preference. Pair mode tries each in
turn and uses the first one it finds on the machine. `auto` tries `pair` first, so an
existing config with no `editor` key now opens pair mode's own pane by default.

`notes` and `layout` both describe position, and they are easy to confuse. `layout`
controls the diff itself — split into two columns, or one inline column. `notes`
controls only where a note you write renders — in a docked panel, or anchored next to
the span it annotates. Setting one does not affect the other.

## Limits

- Pair mode opens one pane per tool call. It cannot batch a changeset, because a hook
  returns one verdict per call and an allow cannot be withdrawn.
- The pane reviews. It does not edit the proposal.
- Syntax colour in pair needs `shiki` installed. A missing package disables colour and
  the pane still works.

## License

MIT. See `LICENSE`.
