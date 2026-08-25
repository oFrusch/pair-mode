# pair mode TUI

The built-in review pane. It replaces micro, vim, and nano as the default editor.

## Purpose

Every external editor gives up something. micro paints one colour group per character, so a
banded row loses its syntax colour. nano has no syntax colour at all. None of them report a
mouse selection back to us. None of them anchor a note to a span of characters.

The TUI owns the render loop, so it keeps syntax colour and change colour on the same row. It
also reads the mouse, which is the feature no external editor can give us.

The external editors stay. A user who wants vim keeps vim.

## Decisions

Owen made these calls on 2026-08-23. They are settled. Do not re-open them during
implementation.

| Decision           | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| Editor name        | `pair`. The `auto` preference resolves to it first.                    |
| Layout             | Split and unified. The user chooses. Split is the default.             |
| Note position      | Docked panel and inline. The user chooses. Panel is the default.       |
| Change colour      | A sign bar in the gutter, plus a background on the changed words only. |
| Full-row band      | On by default. A config flag turns it off for word-level spans.        |
| Syntax colour      | Shiki.                                                                 |
| Note anchor        | The model holds a span. The wire payload holds a line number.          |
| Batched changesets | Out of scope. One pane per tool call, the same as today.               |

### Why the batch is out of scope

Claude Code fires `PreToolUse` once per tool call. The hook returns one verdict, and it returns
it at once. No event tells the hook that a second edit follows. A batch would need the hook to
allow the first edit and then wait. An allow cannot be withdrawn. The hook contract forbids the
batch, so this is not a scope cut.

### Why the wire payload keeps a line number

`Question` in `src/core/collect/types.ts` carries `line`, `code`, and `text`. All four CLI
adapters format that shape. A span anchor would change every adapter. The TUI stores the full
span so it can paint the highlight. It sends the start line, and it appends the selected text
to the question body.

## Where the TUI fits

`runPair` in `src/core/run/run.ts` follows six steps today.

1. `runPair` renders the diff to two string arrays.
2. `runPair` writes those arrays to two temp files.
3. `Editor.prepare` returns argv and an env overlay.
4. The multiplexer runs the argv and blocks.
5. `runPair` reads the right-pane file back.
6. `collect` diffs the saved file against the original right pane to find the questions.

Step 6 is the problem. The TUI knows its notes exactly. It must not round-trip them through a
buffer diff.

### The result-file contract

Add one field to the `Editor` interface in `src/editors/editor.types.ts`.

```
collectMode: "buffer-diff" | "result-file"
```

micro, vim, nvim, nano, and the passthrough editor all declare `"buffer-diff"`. Their behaviour
does not change.

The `pair` editor declares `"result-file"`. `EditorContext` gains a `resultFile` path.
`runPair` creates that path, passes it in, and reads it after the pane closes.

The TUI writes a JSON document to `resultFile` before it exits.

```
{
  "questions": [
    { "line": 34, "code": "  return fmt(out, opts)", "text": "does fmt allocate per call?" }
  ]
}
```

`runPair` branches on `collectMode`. For `"buffer-diff"` it calls `collect` as it does today.
For `"result-file"` it parses the JSON and validates every entry. A missing file, a parse
failure, or a malformed entry produces zero questions. Zero questions means the edit applies,
which matches a clean quit.

The `Question` shape does not change, so `formatQuestions` and all four adapters keep working.

## Module layout

The repo convention is one folder per module, with a logic file, a types file, and a barrel.
The TUI obeys it.

```
src/tui/
  tui.ts            the entry point and the event loop
  tui.types.ts      Screen, Cell, Note, Selection, Mode
  model/
    model.ts        the row model, note list, cursor, and every state transition
    model.types.ts
    index.ts
  paint/
    paint.ts        model to screen lines
    layout.ts       split and unified row builders
    theme.ts        the palette and the truecolor to ANSI 16 fallback
    paint.types.ts
    index.ts
  input/
    keys.ts         raw byte sequences to key events
    mouse.ts        SGR sequences to mouse events
    input.types.ts
    index.ts
  syntax/
    syntax.ts       the Shiki wrapper and the token cache
    syntax.types.ts
    index.ts
  index.ts
src/editors/
  pair.ts           the Editor adapter that launches the TUI
  pair.types.ts
```

`src/tui/` never imports from `src/adapters/`. It imports the diff and render output only.

## The paint pipeline

The TUI paints in four stages. Each stage is a pure function, so each stage gets a unit test.

1. **Build the row model.** `renderSplit` already returns `left`, `right`, and `numbers`. The
   model wraps each index in a `ModelRow` that records its kind. A kind is `header`, `context`,
   `add`, `del`, `fold`, or `pad`.
2. **Resolve tokens.** The syntax module returns a token list per source line. A token holds a
   start column, an end column, and a colour. The tokens come from the original file text, not
   from the marker-prefixed render output.
3. **Compose spans.** Each row becomes a list of styled runs. The change span, the selection,
   and the note highlight all layer on top of the syntax colour as a background. The foreground
   stays the syntax colour.
4. **Emit lines.** The paint stage writes ANSI sequences and returns an array of strings, one
   per terminal row. The event loop diffs that array against the previous frame and writes only
   the rows that changed.

Stage 4 returns strings, so a test asserts the exact escape sequence without a terminal.

## The screen map

The mouse reports a terminal row and column. The model needs a row index and a source column.
The mapping is not the identity, because folds collapse rows and the inline note position
inserts rows.

The paint stage returns a `ScreenMap` beside the lines. The map is an array with one entry per
terminal row.

```
{ kind: "model", index: number, gutterWidth: number, pane: "left" | "right" }
{ kind: "chrome" }
```

A click on a `chrome` row does nothing. A click on a `model` row subtracts `gutterWidth` from
the column to get the source column. The spike failed once on a hardcoded row offset, so the
map is the only source for this mapping. No code computes a row offset by hand.

## Input

### Mouse

The TUI enables SGR mouse reporting on start, and it disables it on exit.

- Enable: `\x1b[?1000h\x1b[?1002h\x1b[?1006h`
- Disable: `\x1b[?1006l\x1b[?1002l\x1b[?1000l`

The parser matches `/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g`. Bit 64 marks a scroll event. Bit 32
marks a drag. `button & 3` gives the base button.

zellij consumes the scroll wheel, so the TUI never depends on it. Keyboard paging covers that
gap.

A `shift` modifier passes straight through. The terminal then selects text for copy, which is
the behaviour every terminal already trains people to expect.

### Keys

| Key               | Mouse        | Action                                                  |
| ----------------- | ------------ | ------------------------------------------------------- |
| `j` `k` `↑` `↓`   | none         | Move the row cursor. A fold moves as one unit.          |
| `^d` `^u`         | none         | Page down and page up.                                  |
| `n` `N`           | none         | Jump to the next and the previous hunk.                 |
| `v` then a motion | drag         | Select a span.                                          |
| `a`               | none         | Open a note on the selection or the current row.        |
| `⏎`               | none         | Save the note. `esc` discards it.                       |
| `tab`             | click a note | Cycle the focused note. The diff scrolls to its anchor. |
| `d`               | none         | Delete the focused note.                                |
| `space`           | click a fold | Expand or collapse a fold row.                          |
| `u`               | none         | Swap between the split layout and the unified layout.   |
| `^s`              | none         | Send the notes. The hook denies the edit.               |
| `^q`              | none         | Quit. Zero notes applies the edit.                      |
| `?`               | none         | Toggle the keymap overlay.                              |

## Colour

Every value is truecolor hex.

| Token     | Hex       | Use                                                   |
| --------- | --------- | ----------------------------------------------------- |
| add bar   | `#3FB950` | The sign column on an added row.                      |
| add span  | `#1F5B2E` | The background behind added words.                    |
| del bar   | `#F85149` | The sign column on a removed row.                     |
| del span  | `#6B2126` | The background behind removed words.                  |
| selection | `#16324F` | The span under an active drag, and an annotated span. |
| note      | `#D2A8FF` | Note markers, the notes panel, the anchor dot.        |
| fold      | `#6E7681` | Collapsed run rows and the line-number gutter.        |
| chrome    | `#E8A33D` | The header brand, the cursor, the active mode.        |

The TUI reads `COLORTERM`. A value of `truecolor` or `24bit` selects the table above. Any other
value selects the ANSI 16 named colours, so a plain `xterm` still reads correctly.

### The intra-line span

A changed pair of rows needs a character-level diff. `jsdiff` already ships
`diffWordsWithSpace`, and the repo already depends on `jsdiff`.

The span is a hint, not a rule. When the two lines share less than 30 percent of their
characters, the whole line takes the span. A line that changed almost completely reads as noise
under word-level marks.

## Syntax colour

Shiki carries the grammars and it runs in Node.

The hook process must start fast. The TUI is a separate process behind the multiplexer, so
Shiki never loads inside the hook. Only `dist/pair-tui.js` carries it.

The build marks `shiki` external. `package.json` declares it a dependency, so `npm install`
brings it. The TUI imports it lazily, inside a `try`. An import failure disables syntax colour
and the pane still works. `pair-mode doctor` reports the state.

`src/editors/languages.ts` already maps a file extension to a language name for micro. The
syntax module reuses that map and translates the name to a Shiki language id.

The token cache lives in memory for the life of the process. A repaint never re-tokenizes.

## Config

`PairConfig` gains three fields. Every field has a default, so an existing config file keeps
working.

| Field           | Type                  | Default   | Meaning                      |
| --------------- | --------------------- | --------- | ---------------------------- |
| `notes`         | `"panel" \| "inline"` | `"panel"` | Where a note renders.        |
| `theme.rowBand` | `boolean`             | `true`    | Paint the whole changed row. |
| `syntax`        | `boolean`             | `true`    | Load Shiki.                  |

`editor` gains `"pair"` as a value. The `"auto"` preference resolves to `pair` first, then
micro, then nvim, then vim, then nano.

`layout` already exists with the values `"split"` and `"inline"`. The TUI reuses it. Do not add
a second layout field.

## Build

The TUI needs its own bundle, and that bundle must be executable.

1. Add `dist/pair-tui.js` to `scripts/build.mjs`.
2. Give it the shebang banner and the `createRequire` banner that the other bundles carry.
3. Call `chmodSync(path, 0o755)` on it.
4. Mark `shiki` external for this bundle only.

A built adapter shipped once with mode 644 and no shebang. The hook died with exit 126, and
`doctor` still reported a pass. Add the TUI bundle to the executable-bit check in `doctor`.

## Verification

Unit tests cover the pure stages.

- The paint stage returns strings. Assert the exact ANSI sequence for an added row, a removed
  row, a fold row, and a selection.
- The screen map returns an array. Assert that a click at a known terminal row and column
  resolves to the expected model row and source column, with a fold above it.
- The intra-line diff returns spans. Assert the span bounds for a small edit and the whole-line
  fallback for a large edit.
- The result-file parser returns questions. Assert that a missing file, malformed JSON, and a
  malformed entry each return zero questions.

Two checks need a real terminal. Every multiplexer test injects a fake spawn, so no unit test
ever exercises zellij. That gap shipped a live bug once already.

1. Run `zellij run` with the TUI against a fixture diff. Then run
   `zellij action dump-screen --ansi` and assert the background colour codes on the changed
   rows.
2. Drive the same pane with a synthetic SGR mouse sequence on stdin. Assert the resulting note
   anchor.

Skip both when `$ZELLIJ` is unset.

## Out of scope for v1

- A batched changeset across tool calls. The hook contract forbids it.
- Editing the proposal inside the pane. The TUI reviews. It does not author.
- A tmux-specific code path. The TUI reads stdin and writes stdout, so the multiplexer layer
  needs no change.
- Search inside the diff.
- Mouse scroll. zellij consumes the wheel, and keyboard paging covers the need.

## Tasks

1. `Editor.collectMode` and the result-file branch in `runPair`. No TUI yet. micro still works.
2. The row model and the screen map, with tests.
3. The paint stage for the split layout, with the sign bar and the intra-line span.
4. The unified layout, plus the narrow-terminal fallback below 90 columns.
5. The key input parser and the event loop.
6. The mouse input parser and drag selection.
7. The notes model, the docked panel, and the result-file writer.
8. The inline note position.
9. Shiki, the language map, and the token cache.
10. `src/editors/pair.ts`, the `"auto"` resolution order, and the new config fields.
11. The build target, the executable bit, and the `doctor` check.
12. The two live zellij checks.
13. The README section and the retirement of the micro syntax generator from the default path.
