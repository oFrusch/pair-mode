---
name: toggle
description: Flip pair mode on or off for this directory. Pair mode opens every proposed edit in the pair review pane for line annotation.
---

Run `pair-mode toggle` and report the resulting state in one line.

If the shell reports that `pair-mode` is not found, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" toggle` instead.

The command reads the current state and moves to the other one. Do not read the status first.

If the user names a state rather than a flip, pass that state instead of `toggle`. The command accepts `on`, `off`, and `status`.

If the user asks for the browser review, add `--web`.

Pair mode intercepts your Write, Edit, and MultiEdit calls. The user reads the proposed diff in the
pair review pane, selects lines, and attaches notes. Pair mode then holds the edit and
returns those notes as questions anchored to line numbers. Answer every question. Do not
re-attempt the edit until the user asks for it. An edit the user closes with no notes
applies as proposed.

Pair mode keys the flag by the real directory path, and the hook walks up from the edited
file. A flag on a parent directory therefore covers every repo beneath it. If pair mode
stays on after an `off`, check each parent with `pair-mode status <dir>`.
