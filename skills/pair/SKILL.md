---
name: pair
description: Toggle pair mode. Every proposed edit opens in the pair review pane for line annotation.
---

Read the action from the user's message, then run `pair-mode <action>` and report the resulting state in one line.

With no action, run `pair-mode status`.

Pair mode intercepts your apply_patch, Write, and Edit calls. The user reads the proposed diff in the
pair review pane, selects lines, and attaches notes. Pair mode then holds the edit and
returns those notes as questions anchored to line numbers. Answer every question. Do not
re-attempt the edit until the user asks for it. An edit the user closes with no notes
applies as proposed.

Pair mode keys the flag by the real directory path, and the hook walks up from the edited
file. A flag on a parent directory therefore covers every repo beneath it. If pair mode
stays on after an `off`, check each parent with `pair-mode status <dir>`.

The `pair-mode` command must resolve on PATH. Install it with `npm install -g pair-mode`.
