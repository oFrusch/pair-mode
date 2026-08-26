import { test, expect } from "vitest";
import { inlineHtml, labelOf, marginNotesHtml, tableHtml } from "../src/web/client";
import type { WebNote } from "../src/web/notes.types";
import type { WebReview, WebRow } from "../src/web/review.types";
import type { FoldGroup, RowKind } from "../src/tui/model";

const NONE = new Set<number>();

function row(
  kind: RowKind,
  left: string,
  right: string,
  leftNumber: number | null,
  rightNumber: number | null,
): WebRow {
  return { kind, left, right, leftNumber, rightNumber, leftTokens: [], rightTokens: [] };
}

function context(text: string, line: number): WebRow {
  return row("context", text, text, line, line);
}

function reviewOf(rows: WebRow[], folds: FoldGroup[] = []): WebReview {
  return { id: "r1", tool: "edit", path: "sample.ts", rows, folds };
}

function noteOf(partial: Partial<WebNote>): WebNote {
  return {
    startRow: 0,
    endRow: 0,
    pane: "right",
    startColumn: 0,
    endColumn: 4,
    text: "why?",
    ...partial,
  };
}

const simple = reviewOf([
  context("const a = 1;", 1),
  row("del", "const b = 2;", "", 2, null),
  row("add", "", "const c = 3;", null, 2),
  row("replace", "const d = 4;", "const d = 5;", 3, 3),
]);

test("tableHtml emits a num, sign and code cell for each pane and no bar cell", () => {
  const html = tableHtml(reviewOf([context("ok", 1)]), [], NONE);

  expect(html).toContain('<td class="num left">1</td>');
  expect(html).toContain('<td class="sign left"> </td>');
  expect(html).toContain('<td class="code left" data-row="0" data-pane="left">ok</td>');
  expect(html).toContain('<td class="num right">1</td>');
  expect(html).toContain('<td class="code right" data-row="0" data-pane="right">ok</td>');
  expect(html).not.toContain('class="bar');
});

test("tableHtml marks all three cells of a pane with no line number as void", () => {
  const html = tableHtml(reviewOf([row("add", "", "new", null, 7)]), [], NONE);

  expect(html).toContain('<td class="num left void"></td>');
  expect(html).toContain('<td class="sign left void"> </td>');
  expect(html).toContain('<td class="code left void" data-row="0" data-pane="left"></td>');
  expect(html).toContain('<td class="num right">7</td>');
  expect(html).not.toContain('class="num right void"');
});

test("tableHtml signs a deletion on the left and an addition on the right", () => {
  const html = tableHtml(simple, [], NONE);

  expect(html).toContain('<td class="sign left">-</td>');
  expect(html).toContain('<td class="sign right void"> </td>');
  expect(html).toContain('<td class="sign right">+</td>');
});

test("tableHtml signs a replace row on both sides", () => {
  const html = tableHtml(reviewOf([row("replace", "old", "new", 1, 1)]), [], NONE);

  expect(html).toContain('<tr class="replace">');
  expect(html).toContain('<td class="sign left">-</td>');
  expect(html).toContain('<td class="sign right">+</td>');
});

test("tableHtml opens a thread row after the last row a note covers", () => {
  const notes = [noteOf({ startRow: 0, endRow: 1, pane: "left", text: "explain" })];
  const html = tableHtml(simple, notes, NONE);

  const firstRow = html.indexOf('data-row="0"');
  const thread = html.indexOf('<tr class="thread">');
  const secondRow = html.indexOf('data-row="1"');
  const thirdRow = html.indexOf('data-row="2"');

  expect(thread).toBeGreaterThan(secondRow);
  expect(thread).toBeLessThan(thirdRow);
  expect(firstRow).toBeLessThan(secondRow);
});

test("tableHtml gives a thread the note label, the note text and a drop button", () => {
  const notes = [noteOf({ startRow: 3, endRow: 3, pane: "right", text: "rename this" })];
  const html = tableHtml(simple, notes, NONE);

  expect(html).toContain('<div class="at">L3</div>');
  expect(html).toContain("<p>rename this</p>");
  expect(html).toContain(
    '<button class="drop" data-drop="0" aria-label="Remove note">&times;</button>',
  );
});

test("tableHtml numbers the drop button of every thread on one row", () => {
  const notes = [
    noteOf({ startRow: 0, endRow: 0, text: "first" }),
    noteOf({ startRow: 0, endRow: 0, text: "second" }),
  ];
  const html = tableHtml(simple, notes, NONE);

  expect(html.split('<tr class="thread">').length - 1).toBe(2);
  expect(html).toContain('data-drop="0"');
  expect(html).toContain('data-drop="1"');
});

test("tableHtml escapes note text rather than emitting it as markup", () => {
  const notes = [noteOf({ text: '</script><img onerror="x">' })];
  const html = tableHtml(simple, notes, NONE);

  expect(html).toContain("&lt;/script&gt;&lt;img onerror=&quot;x&quot;&gt;");
  expect(html).not.toContain("<img");
});

test("tableHtml escapes file content in a code cell", () => {
  const html = tableHtml(reviewOf([context('<b a="1">', 1)]), [], NONE);

  expect(html).toContain("&lt;b a=&quot;1&quot;&gt;");
  expect(html).not.toContain("<b ");
});

test("tableHtml folds unchanged rows behind a row spanning six columns", () => {
  const review = reviewOf(
    [context("a", 1), context("b", 2), context("c", 3)],
    [{ start: 1, count: 2, expanded: false }],
  );
  const html = tableHtml(review, [], NONE);

  expect(html).toContain(
    '<tr class="fold" data-fold="0"><td colspan="6">2 unchanged lines</td></tr>',
  );
  expect(html).toContain('data-row="0"');
  expect(html).not.toContain('data-row="1"');
  expect(html).not.toContain('data-row="2"');
});

test("tableHtml shows the rows of an expanded fold and drops the fold row", () => {
  const review = reviewOf(
    [context("a", 1), context("b", 2), context("c", 3)],
    [{ start: 1, count: 2, expanded: false }],
  );
  const html = tableHtml(review, [], new Set([0]));

  expect(html).not.toContain('class="fold"');
  expect(html).toContain('data-row="1"');
  expect(html).toContain('data-row="2"');
});

test("inlineHtml renders a deletion once, on the left pane", () => {
  const html = inlineHtml(reviewOf([row("del", "gone", "", 4, null)]), [], NONE);

  expect(html.split("<tr").length - 1).toBe(1);
  expect(html).toContain('<tr class="del">');
  expect(html).toContain('<td class="num old">4</td><td class="num new"></td>');
  expect(html).toContain('<td class="sign">-</td>');
  expect(html).toContain('<td class="code left" data-row="0" data-pane="left">gone</td>');
});

test("inlineHtml renders an addition once, on the right pane", () => {
  const html = inlineHtml(reviewOf([row("add", "", "fresh", null, 9)]), [], NONE);

  expect(html.split("<tr").length - 1).toBe(1);
  expect(html).toContain('<tr class="add">');
  expect(html).toContain('<td class="num old"></td><td class="num new">9</td>');
  expect(html).toContain('<td class="sign">+</td>');
  expect(html).toContain('<td class="code right" data-row="0" data-pane="right">fresh</td>');
});

test("inlineHtml renders a context row once, on the right pane", () => {
  const html = inlineHtml(reviewOf([context("same", 6)]), [], NONE);

  expect(html.split("<tr").length - 1).toBe(1);
  expect(html).toContain('<tr class="context">');
  expect(html).toContain('<td class="num old"></td><td class="num new">6</td>');
  expect(html).toContain('<td class="sign"> </td>');
  expect(html).toContain('data-pane="right"');
});

test("inlineHtml splits a replace row into the old line then the new line", () => {
  const html = inlineHtml(reviewOf([row("replace", "old", "new", 2, 3)]), [], NONE);

  expect(html.split("<tr").length - 1).toBe(2);
  expect(html.indexOf('<tr class="del">')).toBeLessThan(html.indexOf('<tr class="add">'));
  expect(html).toContain(
    '<td class="num old">2</td><td class="num new"></td><td class="sign">-</td>',
  );
  expect(html).toContain('<td class="num new">3</td><td class="sign">+</td>');
  expect(html).toContain('data-row="0" data-pane="left">old</td>');
  expect(html).toContain('data-row="0" data-pane="right">new</td>');
});

test("inlineHtml anchors the row that starts a note to that note index", () => {
  const notes = [
    noteOf({ startRow: 3, endRow: 3, pane: "right" }),
    noteOf({ startRow: 1, endRow: 1, pane: "left" }),
  ];
  const html = inlineHtml(simple, notes, NONE);

  expect(html).toContain('data-anchor="1"');
  expect(html).toContain('data-anchor="0"');
  expect(html.split("data-anchor").length - 1).toBe(2);
});

test("inlineHtml leaves a row no note starts on unanchored", () => {
  const notes = [noteOf({ startRow: 1, endRow: 1, pane: "left" })];
  const html = inlineHtml(simple, notes, NONE);

  const anchored = html.slice(html.indexOf('data-row="1"') - 200, html.indexOf('data-row="1"'));

  expect(anchored).toContain('data-anchor="0"');
  expect(html.split("data-anchor").length - 1).toBe(1);
});

test("inlineHtml marks a context row from a note taken in either pane", () => {
  const review = reviewOf([context("same text", 1)]);
  const left = inlineHtml(review, [noteOf({ pane: "left", startColumn: 0, endColumn: 4 })], NONE);
  const right = inlineHtml(review, [noteOf({ pane: "right", startColumn: 0, endColumn: 4 })], NONE);

  expect(left).toContain('<mark class="noted">same</mark>');
  expect(right).toContain('<mark class="noted">same</mark>');
});

test("inlineHtml marks a changed row only from a note in its own pane", () => {
  const review = reviewOf([row("del", "gone away", "", 1, null)]);
  const own = inlineHtml(review, [noteOf({ pane: "left", startColumn: 0, endColumn: 4 })], NONE);
  const other = inlineHtml(review, [noteOf({ pane: "right", startColumn: 0, endColumn: 4 })], NONE);

  expect(own).toContain('<mark class="noted">gone</mark>');
  expect(other).not.toContain("<mark");
});

test("inlineHtml folds unchanged rows behind a row spanning four columns", () => {
  const review = reviewOf(
    [context("a", 1), context("b", 2)],
    [{ start: 1, count: 1, expanded: false }],
  );
  const html = inlineHtml(review, [], NONE);

  expect(html).toContain(
    '<tr class="fold" data-fold="0"><td colspan="4">1 unchanged lines</td></tr>',
  );
  expect(html).not.toContain('data-row="1"');
});

test("inlineHtml shows the rows of an expanded fold", () => {
  const review = reviewOf(
    [context("a", 1), context("b", 2)],
    [{ start: 1, count: 1, expanded: false }],
  );
  const html = inlineHtml(review, [], new Set([0]));

  expect(html).not.toContain('class="fold"');
  expect(html).toContain('data-row="1"');
});

test("inlineHtml escapes file content in a code cell", () => {
  const html = inlineHtml(reviewOf([context("</script><img src=x>", 1)]), [], NONE);

  expect(html).toContain("&lt;/script&gt;");
  expect(html).not.toContain("<img");
});

test("inlineHtml keeps notes out of the table", () => {
  const html = inlineHtml(simple, [noteOf({ startRow: 0, endRow: 0, text: "aside" })], NONE);

  expect(html).not.toContain("thread");
  expect(html).not.toContain("aside");
});

test("marginNotesHtml emits one card per note carrying its index", () => {
  const notes = [
    noteOf({ startRow: 0, endRow: 0, pane: "right", text: "first" }),
    noteOf({ startRow: 3, endRow: 3, pane: "right", text: "second" }),
  ];
  const html = marginNotesHtml(simple, notes);

  expect(html.split('class="note"').length - 1).toBe(2);
  expect(html).toContain('<div class="note" data-card="0">');
  expect(html).toContain('<div class="note" data-card="1">');
  expect(html).toContain('<div class="at">L1</div>');
  expect(html).toContain('<div class="at">L3</div>');
  expect(html).toContain("<p>first</p>");
  expect(html).toContain("<p>second</p>");
});

test("marginNotesHtml gives every card a drop button for its own index", () => {
  const notes = [noteOf({ text: "a" }), noteOf({ text: "b" })];
  const html = marginNotesHtml(simple, notes);

  expect(html).toContain(
    '<button class="drop" data-drop="0" aria-label="Remove note">&times;</button>',
  );
  expect(html).toContain(
    '<button class="drop" data-drop="1" aria-label="Remove note">&times;</button>',
  );
});

test("marginNotesHtml labels a note that spans rows with both line numbers", () => {
  const notes = [noteOf({ startRow: 0, endRow: 3, pane: "right" })];

  expect(marginNotesHtml(simple, notes)).toContain('<div class="at">L1-3</div>');
});

test("marginNotesHtml escapes note text rather than emitting it as markup", () => {
  const html = marginNotesHtml(simple, [noteOf({ text: "<script>alert(1)</script>" })]);

  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).not.toContain("<script>");
});

test("marginNotesHtml renders nothing when no note is open", () => {
  expect(marginNotesHtml(simple, [])).toBe("");
});

test("inlineHtml anchors a context row from a note taken in the left pane", () => {
  const review = reviewOf([context("same text", 1)]);
  const html = inlineHtml(review, [noteOf({ pane: "left" })], NONE);

  expect(html).toContain('<tr class="context" data-anchor="0">');
});

test("inlineHtml lists both notes that start on one row and pane", () => {
  const notes = [
    noteOf({ startRow: 1, endRow: 1, pane: "left", text: "first" }),
    noteOf({ startRow: 1, endRow: 1, pane: "left", startColumn: 6, endColumn: 9, text: "second" }),
  ];
  const html = inlineHtml(simple, notes, NONE);

  expect(html).toContain('<tr class="del" data-anchor="0 1">');
});

test("inlineHtml lists three notes on one row in note order", () => {
  const notes = [
    noteOf({ startRow: 2, endRow: 2, text: "a" }),
    noteOf({ startRow: 2, endRow: 2, startColumn: 6, endColumn: 9, text: "b" }),
    noteOf({ startRow: 2, endRow: 2, startColumn: 9, endColumn: 12, text: "c" }),
  ];
  const html = inlineHtml(simple, notes, NONE);

  expect(html).toContain('<tr class="add" data-anchor="0 1 2">');
  expect(html.split("data-anchor").length - 1).toBe(1);
});

test("inlineHtml leaves a row with no note free of the anchor attribute", () => {
  const html = inlineHtml(simple, [noteOf({ startRow: 2, endRow: 2 })], NONE);
  const rows = html.split("<tr").filter((part) => part.includes("data-row="));
  const anchored = rows.filter((part) => part.includes("data-anchor"));

  expect(rows.length).toBe(5);
  expect(anchored.length).toBe(1);
  expect(anchored[0]).toContain('data-row="2"');
});

test("marginNotesHtml labels a note whose own pane has no number from the other pane", () => {
  const notes = [noteOf({ startRow: 2, endRow: 2, pane: "left" })];
  const html = marginNotesHtml(simple, notes);

  expect(html).toContain('<div class="at">L2</div>');
  expect(html).not.toContain("Lnull");
});

test("labelOf reads the other pane when the start row has no number of its own", () => {
  const note = noteOf({ startRow: 1, endRow: 1, pane: "right" });

  expect(labelOf(simple, note)).toBe("L2");
});

test("labelOf returns nothing when neither pane numbers the start row", () => {
  const review = reviewOf([row("add", "", "orphan", null, null)]);

  expect(labelOf(review, noteOf({}))).toBe("");
});
