import type { Layout } from "../core/config";
import { theme } from "../tui/paint";
import { CLIENT_BUNDLE } from "./client/bundle";

const STYLE = `
:root {
  --bg: #0d1117;
  --chrome: #10141a;
  --rule: #1e242c;
  --text: #c9d1d9;
  --muted: ${theme.fold};
  --dim: #39424d;
  --add-bar: ${theme.addBar};
  --del-bar: ${theme.delBar};
  --add-tint: rgba(63, 185, 80, 0.08);
  --del-tint: rgba(248, 81, 73, 0.08);
  --note: ${theme.note};
  --note-tint: rgba(210, 168, 255, 0.16);
  --amber: ${theme.chrome};
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --serif: "Iowan Old Style", Georgia, "Times New Roman", serif;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  font: 13px/1.6 var(--mono);
  -webkit-font-smoothing: antialiased;
}

/* ---- chrome ---- */

header {
  position: sticky;
  top: 0;
  z-index: 6;
  display: flex;
  align-items: stretch;
  background: var(--chrome);
  border-bottom: 1px solid var(--rule);
  font-size: 12px;
}

header .seg { padding: 6px 13px; white-space: nowrap; }
header .mode { background: var(--amber); color: ${theme.statusText}; font-weight: 700; letter-spacing: 0.1em; }
header .path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--muted); }
header .plus { color: var(--add-bar); }
header .minus { color: var(--del-bar); }
header .tally { color: var(--note); }

footer {
  position: sticky;
  bottom: 0;
  z-index: 6;
  display: flex;
  align-items: stretch;
  background: var(--chrome);
  border-top: 1px solid var(--rule);
  font-size: 11.5px;
}

footer .seg { padding: 6px 12px; color: var(--muted); white-space: nowrap; }
footer .seg .key { color: var(--text); font-weight: 700; }
footer .fill { flex: 1; }

footer .swap { display: flex; }

footer .swap button {
  font: 400 11.5px/1.6 var(--mono);
  padding: 6px 11px;
  border: 0;
  background: none;
  color: var(--muted);
  cursor: pointer;
}

footer .swap button:hover { color: var(--text); }
footer .swap button[aria-pressed="true"] { background: var(--note-tint); color: var(--note); font-weight: 700; }

footer .act {
  font: 700 11.5px/1.6 var(--mono);
  padding: 6px 14px;
  border: 0;
  cursor: pointer;
}

footer .act:disabled { opacity: 0.35; cursor: default; }
footer .act.ok { background: rgba(63, 185, 80, 0.16); color: var(--add-bar); }
footer .act.ok:enabled:hover { background: var(--add-bar); color: #06140a; }
footer .act.send { background: var(--note); color: #170f1e; }
footer .act.send:enabled:hover { filter: brightness(1.12); }

button:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--note); outline-offset: -2px; }

/* ---- diff, both layouts ---- */

main { position: relative; flex: 1; display: flex; align-items: flex-start; }

#diff { flex: 1; min-width: 0; overflow-x: auto; }

table { width: 100%; border-collapse: collapse; }

td { padding: 0; vertical-align: top; white-space: pre; }

td.num {
  width: 1%;
  padding: 0 8px;
  text-align: right;
  color: var(--dim);
  font-variant-numeric: tabular-nums;
  user-select: none;
}

td.sign { width: 1%; padding: 0 6px 0 0; text-align: center; color: var(--dim); user-select: none; }
td.code { cursor: text; padding-right: 18px; }

table.split td.code { width: 50%; }
table.inline td.code { width: auto; }

tr.add td.sign.right, tr.replace td.sign.right { color: var(--add-bar); }
tr.del td.sign.left, tr.replace td.sign.left { color: var(--del-bar); }
tr.add td.sign, tr.add td.code { background: var(--add-tint); }
tr.del td.sign, tr.del td.code { background: var(--del-tint); }
tr.replace td.sign.right, tr.replace td.code.right { background: var(--add-tint); }
tr.replace td.sign.left, tr.replace td.code.left { background: var(--del-tint); }

tr.add td.void, tr.del td.void, tr.replace td.void {
  background: repeating-linear-gradient(-45deg, transparent 0 5px, rgba(255, 255, 255, 0.022) 5px 10px);
  cursor: default;
}

::selection { background: rgba(88, 166, 255, 0.35); }

mark.noted {
  background: var(--note-tint);
  color: inherit;
  box-shadow: inset 0 -2px 0 var(--note);
}

tr.fold td {
  padding: 3px 0 3px 18px;
  color: var(--dim);
  background: rgba(255, 255, 255, 0.016);
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  cursor: pointer;
  user-select: none;
}

tr.fold td:hover { color: var(--text); }

/* ---- notes threaded under a split row ---- */

tr.thread td {
  padding: 9px 22px 10px 60px;
  border-left: 2px solid var(--note);
  background: rgba(210, 168, 255, 0.05);
  white-space: normal;
}

tr.thread .at {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--note);
}

tr.thread p, .note p {
  margin: 2px 0 0;
  max-width: 62ch;
  font-family: var(--serif);
  font-style: italic;
  font-size: 16px;
  line-height: 1.42;
  color: #e7e2ea;
}

/* ---- notes in the inline margin ---- */

#margin {
  position: relative;
  width: 320px;
  flex: none;
  align-self: stretch;
  padding: 0 20px 0 4px;
}

#margin.hidden { display: none; }

.note {
  position: absolute;
  left: 4px;
  right: 20px;
  padding-left: 14px;
  border-left: 1px solid var(--note);
}

.note .at {
  font-size: 10.5px;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--note);
}

#leaders { position: absolute; inset: 0; pointer-events: none; z-index: 1; }

.drop {
  float: right;
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--dim);
  font: 400 14px/1 var(--mono);
  cursor: pointer;
}

.drop:hover { color: var(--del-bar); }

/* ---- popup ---- */

#popup {
  position: absolute;
  z-index: 8;
  display: none;
  width: 320px;
  padding: 11px;
  border: 1px solid var(--note);
  border-radius: 5px;
  background: var(--chrome);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
}

#popup .quote {
  margin-bottom: 7px;
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#popup .row { display: flex; gap: 8px; margin-top: 8px; }

#popup button {
  font: 500 12px/1 var(--mono);
  padding: 6px 12px;
  border: 1px solid var(--rule);
  border-radius: 4px;
  background: none;
  color: var(--text);
  cursor: pointer;
}

#popup button.save { background: var(--note); border-color: var(--note); color: #170f1e; font-weight: 700; }

textarea {
  width: 100%;
  min-height: 66px;
  padding: 7px;
  border: 1px solid var(--rule);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  font: italic 15px/1.4 var(--serif);
  resize: vertical;
}

.hint { color: var(--dim); font-size: 11px; }

#idle { padding: 64px 24px; color: var(--dim); text-align: center; }

@media (max-width: 900px) {
  main { flex-wrap: wrap; }
  #leaders { display: none; }
  #margin { width: 100%; padding: 12px 16px; border-top: 1px solid var(--rule); }
  .note { position: static; margin-bottom: 12px; }
}
`;

// The page wires the DOM, and every markup and geometry decision lives in the typechecked client bundle.
const WIRING = String.raw`
const C = PairClient;
const token = location.pathname.split("/")[2];
const main = document.querySelector("main");
const diff = document.getElementById("diff");
const margin = document.getElementById("margin");
const leaders = document.getElementById("leaders");
const popup = document.getElementById("popup");
const popupQuote = document.getElementById("popup-quote");
const popupText = document.getElementById("popup-text");
const popupSave = document.getElementById("popup-save");
const popupCancel = document.getElementById("popup-cancel");
const sendButton = document.getElementById("send");
const approveButton = document.getElementById("approve");
const pathLabel = document.getElementById("path");
const tallyLabel = document.getElementById("tally");
const plusLabel = document.getElementById("plus");
const minusLabel = document.getElementById("minus");

let review = null;
let notes = [];
let expanded = new Set();
let draft = null;
let layout = document.body.dataset.layout === "inline" ? "inline" : "split";

function isInline() {
  return layout === "inline";
}

function countKinds() {
  let plus = 0;
  let minus = 0;

  review.rows.forEach((row) => {
    if (row.kind === "add" || row.kind === "replace") { plus += 1; }
    if (row.kind === "del" || row.kind === "replace") { minus += 1; }
  });

  return { plus, minus };
}

// A leader line joins a marked run to its card, so it redraws whenever either one moves.
function drawLeaders() {
  if (!isInline() || review === null || notes.length === 0) {
    leaders.innerHTML = "";
    return;
  }

  const base = main.getBoundingClientRect();

  leaders.setAttribute("viewBox", "0 0 " + base.width + " " + base.height);
  leaders.setAttribute("width", base.width);
  leaders.setAttribute("height", base.height);

  leaders.innerHTML = notes.map((_note, index) => {
    const row = diff.querySelector('[data-anchor~="' + index + '"]');
    const card = margin.querySelector('[data-card="' + index + '"]');

    if (row === null || card === null) {
      return "";
    }

    // The line leaves from under the marked run, so it continues that underline and crosses no glyph.
    const marks = row.querySelectorAll("mark.noted");
    const ordinal = (row.dataset.anchor ?? "").split(" ").indexOf(String(index));
    const source = marks[ordinal] ?? marks[marks.length - 1] ?? row;
    const a = source.getBoundingClientRect();
    const b = card.getBoundingClientRect();
    const x1 = a.right - base.left + 5;
    const y1 = a.bottom - base.top - 0.5;
    const x2 = b.left - base.left;
    const y2 = b.top - base.top;
    const mid = x1 + (x2 - x1) * 0.55;

    return '<path d="M ' + x1 + ' ' + y1 + ' C ' + mid + ' ' + y1 + ', ' + mid + ' ' + y2 + ', ' + x2 + ' ' + y2 +
      '" fill="none" stroke="var(--note)" stroke-width="1" stroke-opacity="0.5" />' +
      '<circle cx="' + x1 + '" cy="' + y1 + '" r="2" fill="var(--note)" fill-opacity="0.9" />';
  }).join("");
}

// Two notes on nearby lines would overlap, so each card starts below the one before it.
function placeCards() {
  if (!isInline()) {
    return;
  }

  const base = margin.getBoundingClientRect();
  let floor = 0;

  notes.forEach((_note, index) => {
    const row = diff.querySelector('[data-anchor~="' + index + '"]');
    const card = margin.querySelector('[data-card="' + index + '"]');

    if (row === null || card === null) {
      return;
    }

    const top = Math.max(row.getBoundingClientRect().bottom - base.top, floor);
    card.style.top = top + "px";
    floor = top + card.offsetHeight + 18;
  });
}

function renderMargin() {
  const wanted = isInline() && review !== null && notes.length > 0;

  margin.classList.toggle("hidden", !wanted);
  margin.innerHTML = wanted ? C.marginNotesHtml(review, notes) : "";
}

function render() {
  if (review === null) {
    diff.innerHTML = '<div id="idle">waiting for an edit</div>';
    pathLabel.textContent = "no review open";
    plusLabel.textContent = "";
    minusLabel.textContent = "";
    tallyLabel.textContent = "";
    sendButton.disabled = true;
    approveButton.disabled = true;
    hidePopup();
    renderMargin();
    refreshLeaders();
    return;
  }

  const counts = countKinds();

  pathLabel.textContent = review.path;
  plusLabel.textContent = "+" + counts.plus;
  minusLabel.textContent = "−" + counts.minus;
  tallyLabel.textContent = notes.length === 0 ? "" : notes.length + (notes.length === 1 ? " note" : " notes");
  sendButton.disabled = notes.length === 0;
  sendButton.textContent = "^S send" + (notes.length === 0 ? "" : " " + notes.length);
  approveButton.disabled = false;

  diff.innerHTML = isInline()
    ? C.inlineHtml(review, notes, expanded)
    : C.tableHtml(review, notes, expanded);

  renderMargin();
  refreshLeaders();
}

// A card needs its final height before anything measures it, so the placement waits for the paint.
function refreshLeaders() {
  requestAnimationFrame(() => {
    placeCards();
    drawLeaders();
  });
}

function setLayout(next) {
  layout = next;

  document.querySelectorAll(".swap button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.layout === next));
  });

  hidePopup();
  render();
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

// A hidden textarea still holds focus, and the key handler ignores every key while it does.
function hidePopup() {
  popup.style.display = "none";
  popupText.value = "";
  popupText.blur();
  draft = null;
}

function showPopup(selected) {
  draft = selected.span;
  popupQuote.textContent = C.quoteOf(review, selected.span) || "(whole line)";

  const top = window.scrollY + selected.rect.bottom + 8;
  const left = Math.max(8, Math.min(window.scrollX + selected.rect.left, window.innerWidth - 340));

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
  const fold = event.target instanceof Element ? event.target.closest("[data-fold]") : null;

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

document.addEventListener("click", (event) => {
  const drop = event.target instanceof Element ? event.target.closest("[data-drop]") : null;

  if (drop === null) {
    return;
  }

  const dropped = Number(drop.dataset.drop);
  notes = notes.filter((_note, index) => index !== dropped);
  render();
});

document.querySelectorAll(".swap button").forEach((button) => {
  button.addEventListener("click", () => setLayout(button.dataset.layout));
});

// The pane binds u to the same swap, so the browser answers the key a pair mode user already knows.
document.addEventListener("keydown", (event) => {
  if (event.target === popupText || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  if (event.key === "u") {
    setLayout(isInline() ? "split" : "inline");
  }
});

// The footer names ^S and ^Q, so both keys act rather than reaching the browser.
document.addEventListener("keydown", (event) => {
  if (!event.ctrlKey || event.metaKey || event.altKey || review === null) {
    return;
  }

  if (event.key === "s" && notes.length > 0) {
    event.preventDefault();
    post({ id: review.id, notes });
    return;
  }

  if (event.key === "q") {
    event.preventDefault();
    post({ id: review.id, notes: [] });
  }
});

window.addEventListener("resize", () => {
  placeCards();
  drawLeaders();
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

function pressed(layout: Layout, wanted: Layout): string {
  return layout === wanted ? "true" : "false";
}

export function renderPage(layout: Layout = "split"): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pair mode</title>
<style>${STYLE}</style>
</head>
<body data-layout="${layout}">
<header>
  <span class="seg mode">PAIR</span>
  <span class="seg path" id="path">no review open</span>
  <span class="seg plus" id="plus"></span>
  <span class="seg minus" id="minus"></span>
  <span class="seg tally" id="tally"></span>
</header>
<main>
  <svg id="leaders" aria-hidden="true"></svg>
  <div id="diff"></div>
  <div id="margin"></div>
</main>
<footer>
  <span class="seg">drag to <span class="key">note</span></span>
  <span class="seg">click a fold to <span class="key">open</span></span>
  <span class="swap" role="group" aria-label="Layout">
    <button data-layout="inline" aria-pressed="${pressed(layout, "inline")}">u inline</button>
    <button data-layout="split" aria-pressed="${pressed(layout, "split")}">u split</button>
  </span>
  <span class="fill"></span>
  <button class="act ok" id="approve">^Q approve</button>
  <button class="act send" id="send">^S send</button>
</footer>
<div id="popup">
  <div class="quote" id="popup-quote"></div>
  <textarea id="popup-text" placeholder="What do you want to ask?"></textarea>
  <div class="row">
    <button class="save" id="popup-save">Add note</button>
    <button id="popup-cancel">Cancel</button>
  </div>
  <div class="hint">Enter saves. Shift-Enter makes a new line.</div>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
