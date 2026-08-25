import { theme } from "../tui/paint";

const STYLE = `
:root {
  --bg: #0d1117;
  --panel: #12171f;
  --line: #21262d;
  --text: #c9d1d9;
  --muted: ${theme.fold};
  --chrome: ${theme.chrome};
  --add-bar: ${theme.addBar};
  --del-bar: ${theme.delBar};
  --add-tint: rgba(63, 185, 80, 0.09);
  --del-tint: rgba(248, 81, 73, 0.09);
  --note: ${theme.note};
  --note-tint: rgba(210, 168, 255, 0.22);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

header {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 14px;
  background: var(--chrome);
  color: #1f1a12;
  font-weight: 600;
}

header .path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

button {
  font: inherit;
  padding: 4px 12px;
  border: 1px solid rgba(0, 0, 0, 0.35);
  border-radius: 5px;
  background: #1f1a12;
  color: #f0e6d2;
  cursor: pointer;
}

button:disabled { opacity: 0.4; cursor: default; }

main { display: flex; align-items: flex-start; }

#diff { flex: 1; min-width: 0; overflow-x: auto; }

table { width: 100%; border-collapse: collapse; }

td { padding: 0 8px; vertical-align: top; white-space: pre; }

td.num {
  width: 1%;
  padding: 0 6px;
  text-align: right;
  color: var(--muted);
  user-select: none;
}

td.bar { width: 3px; padding: 0; }

tr.add td.bar.right, tr.replace td.bar.right { background: var(--add-bar); }
tr.del td.bar.left, tr.replace td.bar.left { background: var(--del-bar); }

tr.add td.code.right, tr.replace td.code.right { background: var(--add-tint); }
tr.del td.code.left, tr.replace td.code.left { background: var(--del-tint); }

td.code { width: 50%; cursor: text; }

::selection { background: rgba(88, 166, 255, 0.35); }

mark.noted {
  background: var(--note-tint);
  border-bottom: 2px solid var(--note);
  color: inherit;
  border-radius: 2px;
}

tr.fold td {
  padding: 2px 8px;
  color: var(--muted);
  background: var(--panel);
  cursor: pointer;
  text-align: center;
  user-select: none;
}

tr.fold td:hover { color: var(--text); }

aside {
  position: sticky;
  top: 40px;
  width: 300px;
  flex: none;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 12px;
  border-left: 1px solid var(--line);
  background: var(--panel);
}

aside h2 {
  margin: 0 0 10px;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--muted);
  text-transform: uppercase;
}

.note {
  margin-bottom: 10px;
  padding: 8px 10px;
  border-left: 3px solid var(--note);
  border-radius: 0 4px 4px 0;
  background: var(--bg);
}

.note .where { color: var(--note); font-size: 11px; }
.note .quote { margin: 3px 0; color: var(--muted); font-size: 11px; }
.note .body { white-space: pre-wrap; }

.note .drop {
  float: right;
  padding: 0 6px;
  border: 0;
  background: none;
  color: var(--muted);
}

.note .drop:hover { color: var(--del-bar); }

#popup {
  position: absolute;
  z-index: 5;
  display: none;
  width: 300px;
  padding: 10px;
  border: 1px solid var(--note);
  border-radius: 6px;
  background: var(--panel);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

#popup .quote {
  margin-bottom: 6px;
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#popup .row { display: flex; gap: 8px; margin-top: 8px; }

textarea {
  width: 100%;
  min-height: 62px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  resize: vertical;
}

.hint { color: var(--muted); font-size: 11px; }

#idle { padding: 48px; color: var(--muted); text-align: center; }
`;

const SCRIPT = String.raw`
const token = location.pathname.split("/")[2];
const diff = document.getElementById("diff");
const notesPanel = document.getElementById("notes");
const popup = document.getElementById("popup");
const popupQuote = document.getElementById("popup-quote");
const popupText = document.getElementById("popup-text");
const popupSave = document.getElementById("popup-save");
const popupCancel = document.getElementById("popup-cancel");
const sendButton = document.getElementById("send");
const approveButton = document.getElementById("approve");
const pathLabel = document.getElementById("path");

let review = null;
let notes = [];
let expanded = new Set();
let draftRange = null;

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]);
}

function textOf(row, pane) {
  return pane === "right" ? row.right : row.left;
}

function tokensOf(row, pane) {
  return pane === "right" ? row.rightTokens : row.leftTokens;
}

function numberOf(row, pane) {
  return pane === "right" ? row.rightNumber : row.leftNumber;
}

// A note covers whole lines between its ends, so only the first and last rows carry a column range.
function markRange(note, rowIndex, length) {
  const start = rowIndex === note.startRow ? note.startColumn : 0;
  const end = rowIndex === note.endRow ? note.endColumn : length;
  return { start: Math.max(0, start), end: Math.min(length, end) };
}

function marksFor(rowIndex, pane, length) {
  return notes
    .filter((note) => note.pane === pane && rowIndex >= note.startRow && rowIndex <= note.endRow)
    .map((note) => markRange(note, rowIndex, length))
    .filter((range) => range.end > range.start);
}

// One pass per character keeps token colour and note highlight from fighting over the same span.
function paintCell(text, tokens, marks) {
  if (text === "") {
    return "";
  }

  const colors = new Array(text.length).fill(null);

  tokens.forEach((token) => {
    for (let index = token.start; index < token.end && index < text.length; index += 1) {
      colors[index] = token.color;
    }
  });

  const marked = new Array(text.length).fill(false);

  marks.forEach((range) => {
    for (let index = range.start; index < range.end; index += 1) {
      marked[index] = true;
    }
  });

  const parts = [];
  let cursor = 0;

  while (cursor < text.length) {
    let end = cursor + 1;

    while (end < text.length && colors[end] === colors[cursor] && marked[end] === marked[cursor]) {
      end += 1;
    }

    const body = escapeHtml(text.slice(cursor, end));
    const styled = colors[cursor] === null ? body : '<span style="color:' + colors[cursor] + '">' + body + "</span>";
    parts.push(marked[cursor] ? '<mark class="noted">' + styled + "</mark>" : styled);
    cursor = end;
  }

  return parts.join("");
}

function hiddenRows() {
  const hidden = new Set();

  review.folds.forEach((fold, foldIndex) => {
    if (expanded.has(foldIndex)) {
      return;
    }

    for (let offset = 0; offset < fold.count; offset += 1) {
      hidden.add(fold.start + offset);
    }
  });

  return hidden;
}

function cell(row, rowIndex, pane) {
  const text = textOf(row, pane);
  const body = paintCell(text, tokensOf(row, pane), marksFor(rowIndex, pane, text.length));

  return (
    '<td class="num ' + pane + '">' + (numberOf(row, pane) ?? "") + "</td>" +
    '<td class="bar ' + pane + '"></td>' +
    '<td class="code ' + pane + '" data-row="' + rowIndex + '" data-pane="' + pane + '">' + body + "</td>"
  );
}

function render() {
  if (review === null) {
    diff.innerHTML = '<div id="idle">waiting for an edit</div>';
    pathLabel.textContent = "no review open";
    sendButton.disabled = true;
    approveButton.disabled = true;
    hidePopup();
    renderNotes();
    return;
  }

  pathLabel.textContent = review.path;
  sendButton.disabled = notes.length === 0;
  approveButton.disabled = false;

  const hidden = hiddenRows();
  const parts = ["<table>"];

  review.rows.forEach((row, index) => {
    const foldIndex = review.folds.findIndex((fold) => fold.start === index);

    if (foldIndex >= 0 && !expanded.has(foldIndex)) {
      const fold = review.folds[foldIndex];
      parts.push(
        '<tr class="fold" data-fold="' + foldIndex + '"><td colspan="6">' +
          fold.count + " unchanged lines</td></tr>",
      );
    }

    if (hidden.has(index)) {
      return;
    }

    parts.push(
      '<tr class="' + row.kind + '">' + cell(row, index, "left") + cell(row, index, "right") + "</tr>",
    );
  });

  parts.push("</table>");
  diff.innerHTML = parts.join("");
  renderNotes();
}

function quoteOf(note) {
  const row = review.rows[note.startRow];
  const text = textOf(row, note.pane);
  const end = note.endRow > note.startRow ? text.length : note.endColumn;
  return text.slice(note.startColumn, end).trim();
}

function labelOf(note) {
  const start = numberOf(review.rows[note.startRow], note.pane);
  const end = numberOf(review.rows[note.endRow], note.pane);
  return start === end || end === null ? "L" + start : "L" + start + "-" + end;
}

function renderNotes() {
  if (review === null || notes.length === 0) {
    notesPanel.innerHTML = '<div class="hint">Select any text in the diff to leave a note.</div>';
    return;
  }

  notesPanel.innerHTML = notes
    .map((note, index) =>
      '<div class="note"><button class="drop" data-drop="' + index + '">&times;</button>' +
      '<div class="where">' + labelOf(note) + "</div>" +
      '<div class="quote">' + escapeHtml(quoteOf(note)) + "</div>" +
      '<div class="body">' + escapeHtml(note.text) + "</div></div>",
    )
    .join("");
}

function cellOf(node) {
  const element = node.nodeType === 1 ? node : node.parentElement;
  return element === null ? null : element.closest("td.code");
}

// A DOM range can start inside a colour span, so the offset comes from the text between the cell start and that point.
function columnIn(cellNode, node, offset) {
  const range = document.createRange();
  range.selectNodeContents(cellNode);
  range.setEnd(node, offset);
  return range.toString().length;
}

function readSelection() {
  const selection = window.getSelection();

  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const startCell = cellOf(range.startContainer);
  const endCell = cellOf(range.endContainer);

  if (startCell === null || endCell === null || startCell.dataset.pane !== endCell.dataset.pane) {
    return null;
  }

  return {
    startRow: Number(startCell.dataset.row),
    endRow: Number(endCell.dataset.row),
    pane: startCell.dataset.pane,
    startColumn: columnIn(startCell, range.startContainer, range.startOffset),
    endColumn: columnIn(endCell, range.endContainer, range.endOffset),
    rect: range.getBoundingClientRect(),
  };
}

function hidePopup() {
  popup.style.display = "none";
  popupText.value = "";
  draftRange = null;
}

function showPopup(selected) {
  draftRange = selected;
  popupQuote.textContent = quoteOf(selected) || "(whole line)";

  const top = window.scrollY + selected.rect.bottom + 8;
  const left = Math.max(8, Math.min(window.scrollX + selected.rect.left, window.innerWidth - 320));

  popup.style.top = top + "px";
  popup.style.left = left + "px";
  popup.style.display = "block";
  popupText.focus();
}

diff.addEventListener("mouseup", () => {
  const selected = readSelection();

  if (selected === null) {
    return;
  }

  showPopup(selected);
});

diff.addEventListener("click", (event) => {
  const fold = event.target.closest("[data-fold]");

  if (fold === null) {
    return;
  }

  expanded.add(Number(fold.dataset.fold));
  render();
});

// The panel matches the order the agent receives, so a note sits where its line sits.
function sortNotes() {
  notes.sort((first, second) =>
    first.startRow === second.startRow
      ? first.startColumn - second.startColumn
      : first.startRow - second.startRow,
  );
}

function saveDraft() {
  const text = popupText.value.trim();

  if (draftRange === null || text === "") {
    return;
  }

  notes.push({
    startRow: draftRange.startRow,
    endRow: draftRange.endRow,
    pane: draftRange.pane,
    startColumn: draftRange.startColumn,
    endColumn: draftRange.endColumn,
    text,
  });

  sortNotes();
  hidePopup();
  window.getSelection()?.removeAllRanges();
  render();
}

popupSave.addEventListener("click", saveDraft);
popupCancel.addEventListener("click", hidePopup);

popupText.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hidePopup();
    return;
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    saveDraft();
  }
});

notesPanel.addEventListener("click", (event) => {
  const drop = event.target.closest("[data-drop]");

  if (drop === null) {
    return;
  }

  notes.splice(Number(drop.dataset.drop), 1);
  render();
});

function post(payload) {
  return fetch("/r/" + token + "/verdict", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).then(() => {
    review = null;
    notes = [];
    expanded = new Set();
    render();
  });
}

sendButton.addEventListener("click", () => post({ id: review.id, notes }));
approveButton.addEventListener("click", () => post({ id: review.id, notes: [] }));

const events = new EventSource("/r/" + token + "/events");

events.addEventListener("review", (event) => {
  review = JSON.parse(event.data);
  notes = [];
  expanded = new Set();
  hidePopup();
  render();
});

events.addEventListener("cancel", () => {
  review = null;
  notes = [];
  render();
});

render();
`;

export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pair mode</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <span>pair mode</span>
  <span class="path" id="path">no review open</span>
  <button id="approve">Approve</button>
  <button id="send">Send notes</button>
</header>
<main>
  <div id="diff"></div>
  <aside>
    <h2>Notes</h2>
    <div id="notes"></div>
  </aside>
</main>
<div id="popup">
  <div class="quote" id="popup-quote"></div>
  <textarea id="popup-text" placeholder="What do you want to ask?"></textarea>
  <div class="row">
    <button id="popup-save">Add note</button>
    <button id="popup-cancel">Cancel</button>
  </div>
  <div class="hint">Enter saves. Shift-Enter makes a new line.</div>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
