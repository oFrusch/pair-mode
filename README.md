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

| Editor | Diff colour | Syntax colour on changed rows                                                                                |
| ------ | ----------- | ------------------------------------------------------------------------------------------------------------ |
| micro  | Yes         | No. micro paints one highlight group per character, so a changed row trades syntax colour for the diff band. |
| vim    | Yes         | Yes. `matchadd()` overlays the diff highlight on top of syntax, so a changed row keeps both.                 |
| nvim   | Yes         | Yes. Same `matchadd()` overlay as vim.                                                                       |
| nano   | Yes         | No. nano has no syntax engine here, so a changed row gets the diff band only.                                |

Keys:

- micro: Ctrl+W or F2 sends your annotations and closes the editor. F3 moves between
  panes.
- vim and nvim: `:wqa` sends your annotations and closes the editor.

## Multiplexers

Claude Code and Codex run their hooks with no controlling terminal. `/dev/tty` returns
`ENXIO` there. Pair mode needs zellij or tmux to open an editor pane under those two
CLIs. pi and opencode run hooks with a controlling terminal already attached, so no
multiplexer is required for them.

## Configuration

Pair mode reads `$XDG_CONFIG_HOME/pair-mode/config.json`, or `~/.config/pair-mode/config.json`
when `XDG_CONFIG_HOME` is not set.

| Key           | Type                                                                          | Default     |
| ------------- | ----------------------------------------------------------------------------- | ----------- |
| `editor`      | `"auto" \| "micro" \| "nvim" \| "vim" \| "nano"`, or an array of editor names | `"auto"`    |
| `multiplexer` | `"auto" \| "zellij" \| "tmux" \| "none"`                                      | `"auto"`    |
| `layout`      | `"split" \| "inline"`                                                         | `"split"`   |
| `context`     | integer, 1 or more                                                            | `5`         |
| `minFold`     | integer, 1 or more                                                            | `4`         |
| `pane.width`  | string                                                                        | `"90%"`     |
| `pane.height` | string                                                                        | `"90%"`     |
| `theme.add`   | 6-digit hex colour                                                            | `"#1e3a1e"` |
| `theme.del`   | 6-digit hex colour                                                            | `"#3a1e1e"` |
| `theme.fold`  | 6-digit hex colour                                                            | `"#2a2a2a"` |
| `trace`       | boolean                                                                       | `false`     |

An `editor` array lists editor names in order of preference. Pair mode tries each in
turn and uses the first one it finds on the machine.

## Known limits

- Pair mode opens one editor pane per `Edit` call, not one pane per changeset.
- opencode hooks do not fire for subagent tool calls or MCP tool calls.
- Claude Code cannot add a choice to its permission menu. Pair mode opens on every
  edit while it is enabled.

## License

MIT. See `LICENSE`.
