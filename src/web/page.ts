import { theme } from "../tui/paint";
import { CLIENT_BUNDLE } from "./client/bundle";

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

// The page wires the DOM, and every markup and geometry decision lives in the typechecked client bundle.
const WIRING = String.raw`
const C = PairClient;
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
let draft = null;

function renderNotes() {
  if (review === null || notes.length === 0) {
    notesPanel.innerHTML = '<div class="hint">Select any text in the diff to leave a note.</div>';
    return;
  }

  notesPanel.innerHTML = C.notesHtml(review, notes);
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
  diff.innerHTML = C.tableHtml(review, notes, expanded);
  renderNotes();
}

function cellOf(node) {
  const element = node.nodeType === 1 ? node : node.parentElement;
  return element === null ? null : element.closest("td.code");
}

function refOf(cell) {
  return cell === null ? null : { row: cell.dataset.row, pane: cell.dataset.pane };
}

function readSelection() {
  const selection = window.getSelection();

  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const startCell = cellOf(range.startContainer);
  const endCell = cellOf(range.endContainer);

  if (startCell === null || endCell === null) {
    return null;
  }

  const startColumn = C.columnIn(document.createRange(), startCell, range.startContainer, range.startOffset);
  const endColumn = C.columnIn(document.createRange(), endCell, range.endContainer, range.endOffset);
  const span = C.draftRange(refOf(startCell), refOf(endCell), startColumn, endColumn);

  return span === null ? null : { span, rect: range.getBoundingClientRect() };
}

function hidePopup() {
  popup.style.display = "none";
  popupText.value = "";
  draft = null;
}

function showPopup(selected) {
  draft = selected.span;
  popupQuote.textContent = C.quoteOf(review, selected.span) || "(whole line)";

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

  expanded = new Set(expanded).add(Number(fold.dataset.fold));
  render();
});

function saveDraft() {
  const text = popupText.value.trim();

  if (draft === null || text === "") {
    return;
  }

  notes = C.sortedNotes([...notes, { ...draft, text }]);
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

  const dropped = Number(drop.dataset.drop);
  notes = notes.filter((_note, index) => index !== dropped);
  render();
});

function warn(message) {
  pathLabel.textContent = message;
}

function clearReview() {
  review = null;
  notes = [];
  expanded = new Set();
  render();
}

function post(payload) {
  sendButton.disabled = true;
  approveButton.disabled = true;

  return fetch("/r/" + token + "/verdict", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((response) => {
      // A refused verdict means another client already answered, so the notes typed here can never land.
      if (!response.ok) {
        clearReview();
        warn("this review was already answered elsewhere - your notes were not sent");
        return;
      }

      clearReview();
    })
    .catch(() => {
      sendButton.disabled = notes.length === 0;
      approveButton.disabled = review === null;
      warn("could not reach pair mode - check the terminal and try again");
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

// A cancel names the review it withdraws, so a late frame never clears the one now open.
events.addEventListener("cancel", (event) => {
  const cancelled = JSON.parse(event.data);

  if (review === null || review.id !== cancelled.id) {
    return;
  }

  clearReview();
});

render();
`;

// A literal closing tag inside the script would end the block early, and only a string can carry one.
function inlineScript(source: string): string {
  return source.replaceAll("</script", String.raw`<\/script`);
}

const SCRIPT = inlineScript(`${CLIENT_BUNDLE}\n${WIRING}`);

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
