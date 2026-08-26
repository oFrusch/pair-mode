import { join } from "node:path";
import { test, expect, beforeEach, afterEach } from "vitest";
import { startWebServer, startWebWatch, toWebReview, renderPage } from "../src/web";
import { columnIn, draftRange, escapeHtml, paintCell } from "../src/web/client";
import type { RangeLike } from "../src/web/client";
import type { WebServer, WebWatcher } from "../src/web";
import { DEFAULT_CONFIG } from "../src/core/config";
import type { PairConfig } from "../src/core/config";
import type { Question } from "../src/core/collect";
import type { ReviewMessage } from "../src/transports/session";
import { createSessionTransport } from "../src/transports/session";
import { isRecord } from "../src/helpers";
import { useIsolatedHome } from "./helpers/env";

const isolated = useIsolatedHome();

const TOKEN = "0123456789abcdef0123456789abcdef";
const OK = 200;
const NOT_FOUND = 404;
const BAD_REQUEST = 400;
const CONFLICT = 409;
const PAYLOAD_TOO_LARGE = 413;

let web: WebServer | null = null;
let watcher: WebWatcher | null = null;
let socketPath: string;

beforeEach(() => {
  const dir = isolated.tempDir("pair-web-");
  socketPath = join(dir, "s.sock");
});

afterEach(async () => {
  if (web !== null) {
    await web.close();
    web = null;
  }

  if (watcher !== null) {
    await watcher.close();
    watcher = null;
  }
});

const config: PairConfig = { ...DEFAULT_CONFIG, transport: "session", context: 1, minFold: 1 };

const review: ReviewMessage = {
  type: "review",
  id: "id1",
  tool: "edit",
  path: "sample.ts",
  before: "const a = 1;\nconst b = 2;\n",
  after: "const a = 1;\nconst b = 3;\n",
};

function startPlain(onVerdict: (id: string, questions: Question[]) => void): Promise<WebServer> {
  return startWebServer({ port: 0, token: TOKEN, onVerdict });
}

// The stream opens with a comment line, so a reader keeps pulling until the event it wants arrives.
async function readUntil(url: string, marker: string): Promise<{ text: string; cancel(): void }> {
  const response = await fetch(url);
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (!text.includes(marker)) {
    const chunk = await reader?.read();

    if (chunk === undefined || chunk.done) {
      break;
    }

    text += decoder.decode(chunk.value, { stream: true });
  }

  return { text, cancel: () => void reader?.cancel() };
}

// A withdrawal only reaches a viewer that was already listening, so the stream stays open across the test.
async function openViewer(
  url: string,
): Promise<{ until(marker: string): Promise<string>; cancel(): void }> {
  const response = await fetch(url);
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let text = "";

  return {
    async until(marker: string): Promise<string> {
      while (!text.includes(marker)) {
        const chunk = await reader?.read();

        if (chunk === undefined || chunk.done) {
          break;
        }

        text += decoder.decode(chunk.value, { stream: true });
      }

      return text;
    },
    cancel: () => void reader?.cancel(),
  };
}

test("the review page loads at the token path", async () => {
  web = await startPlain(() => {});

  const response = await fetch(web.url);
  const body = await response.text();

  expect(response.status).toBe(OK);
  expect(body).toContain("<title>pair mode</title>");
  expect(body).toContain('id="diff"');
});

test("the token path serves the duck favicon as a PNG", async () => {
  web = await startPlain(() => {});

  const response = await fetch(`${web.url}/favicon.png`);
  const bytes = new Uint8Array(await response.arrayBuffer());

  expect(response.status).toBe(OK);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
});

test("the review page resolves its favicon inside the token path", async () => {
  web = await startPlain(() => {});

  const body = await (await fetch(web.url)).text();
  const href = body.match(/<link rel="icon" type="image\/png" href="([^"]+)">/)?.[1];

  expect(new URL(href ?? "", web.url).pathname).toBe(`/r/${TOKEN}/favicon.png`);
});

test("a wrong token returns 404 rather than 403", async () => {
  web = await startPlain(() => {});

  const response = await fetch(`http://127.0.0.1:${web.port}/r/wrongtoken`);

  expect(response.status).toBe(NOT_FOUND);
});

test("the page never leaks the token to an unauthenticated route", async () => {
  web = await startPlain(() => {});

  const response = await fetch(`http://127.0.0.1:${web.port}/`);
  const body = await response.text();

  expect(response.status).toBe(NOT_FOUND);
  expect(body).not.toContain(TOKEN);
});

test("a whole-line note becomes a question with no span suffix", async () => {
  const seen: { id: string; questions: Question[] }[] = [];
  web = await startPlain((id, questions) => seen.push({ id, questions }));
  web.offer(await toWebReview(review, config));

  const response = await fetch(`${web.url}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "id1",
      notes: [
        {
          startRow: 1,
          endRow: 1,
          pane: "right",
          startColumn: 0,
          endColumn: 12,
          text: "why?",
        },
      ],
    }),
  });

  expect(response.status).toBe(OK);
  expect(seen).toEqual([
    { id: "id1", questions: [{ line: 2, code: "const b = 3;", text: "why?" }] },
  ]);
});

test("a partial span note carries the selected text as a suffix", async () => {
  const seen: Question[][] = [];
  web = await startPlain((_id, questions) => seen.push(questions));
  web.offer(await toWebReview(review, config));

  await fetch(`${web.url}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "id1",
      notes: [
        { startRow: 1, endRow: 1, pane: "right", startColumn: 10, endColumn: 11, text: "why 3?" },
      ],
    }),
  });

  expect(seen[0]).toEqual([{ line: 2, code: "const b = 3;", text: 'why 3? [re: "3"]' }]);
});

test("a note spanning two rows reports the first line and covers the whole first row", async () => {
  const seen: Question[][] = [];
  web = await startPlain((_id, questions) => seen.push(questions));
  web.offer(await toWebReview(review, config));

  await fetch(`${web.url}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "id1",
      notes: [
        { startRow: 0, endRow: 1, pane: "right", startColumn: 0, endColumn: 5, text: "both" },
      ],
    }),
  });

  expect(seen[0]).toEqual([{ line: 1, code: "const a = 1;", text: "both" }]);
});

test("questions arrive in line order however the notes were written", async () => {
  const seen: Question[][] = [];
  web = await startPlain((_id, questions) => seen.push(questions));
  web.offer(await toWebReview(review, config));

  await fetch(`${web.url}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "id1",
      notes: [
        { startRow: 1, endRow: 1, pane: "right", startColumn: 0, endColumn: 12, text: "second" },
        { startRow: 0, endRow: 0, pane: "right", startColumn: 0, endColumn: 12, text: "first" },
      ],
    }),
  });

  expect(seen[0]?.map((question) => question.line)).toEqual([1, 2]);
  expect(seen[0]?.map((question) => question.text)).toEqual(["first", "second"]);
});

test("two notes on one line arrive in column order", async () => {
  const seen: Question[][] = [];
  web = await startPlain((_id, questions) => seen.push(questions));
  web.offer(await toWebReview(review, config));

  await fetch(`${web.url}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "id1",
      notes: [
        { startRow: 1, endRow: 1, pane: "right", startColumn: 10, endColumn: 11, text: "later" },
        { startRow: 1, endRow: 1, pane: "right", startColumn: 6, endColumn: 7, text: "earlier" },
      ],
    }),
  });

  expect(seen[0]?.map((question) => question.text)).toEqual([
    'earlier [re: "b"]',
    'later [re: "3"]',
  ]);
});

test("a verdict naming another review is refused and leaves the open one alone", async () => {
  const seen: string[] = [];
  web = await startPlain((id) => seen.push(id));
  web.offer(await toWebReview(review, config));

  const response = await fetch(`${web.url}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "bogus", notes: [] }),
  });

  expect(response.status).toBe(CONFLICT);
  expect(seen).toEqual([]);
});

test("the open review survives a refused verdict and still answers the right one", async () => {
  const seen: string[] = [];
  web = await startPlain((id) => seen.push(id));
  web.offer(await toWebReview(review, config));

  await fetch(`${web.url}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "bogus", notes: [] }),
  });

  const response = await fetch(`${web.url}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "id1", notes: [] }),
  });

  expect(response.status).toBe(OK);
  expect(seen).toEqual(["id1"]);
});

test("a verdict arriving with no review open is refused", async () => {
  const seen: string[] = [];
  web = await startPlain((id) => seen.push(id));

  const response = await fetch(`${web.url}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "id1", notes: [] }),
  });

  expect(response.status).toBe(CONFLICT);
  expect(seen).toEqual([]);
});

test("an empty note list produces an approval with no questions", async () => {
  const seen: Question[][] = [];
  web = await startPlain((_id, questions) => seen.push(questions));
  web.offer(await toWebReview(review, config));

  await fetch(`${web.url}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "id1", notes: [] }),
  });

  expect(seen[0]).toEqual([]);
});

test("a malformed note is rejected and never reaches the handler", async () => {
  const seen: string[] = [];
  web = await startPlain((id) => seen.push(id));

  const response = await fetch(`${web.url}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "id1", notes: [{ startRow: 1, pane: "right" }] }),
  });

  expect(response.status).toBe(BAD_REQUEST);
  expect(seen).toEqual([]);
});

test("a note naming an unknown pane is rejected", async () => {
  const seen: string[] = [];
  web = await startPlain((id) => seen.push(id));

  const response = await fetch(`${web.url}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "id1",
      notes: [{ startRow: 0, endRow: 0, pane: "middle", startColumn: 0, endColumn: 1, text: "x" }],
    }),
  });

  expect(response.status).toBe(BAD_REQUEST);
  expect(seen).toEqual([]);
});

test("a verdict with a wrong token never reaches the handler", async () => {
  const seen: string[] = [];
  web = await startPlain((id) => seen.push(id));

  const response = await fetch(`http://127.0.0.1:${web.port}/r/wrongtoken/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "id1", notes: [] }),
  });

  expect(response.status).toBe(NOT_FOUND);
  expect(seen).toEqual([]);
});

test("a viewer that joins after a review is offered receives it at once", async () => {
  web = await startPlain(() => {});
  web.offer(await toWebReview(review, config));

  const stream = await readUntil(`${web.url}/events`, "event: review");
  stream.cancel();

  expect(stream.text).toContain("event: review");
  expect(stream.text).toContain("sample.ts");
});

test("a viewer with no review open still receives the opening stream", async () => {
  web = await startPlain(() => {});

  const stream = await readUntil(`${web.url}/events`, ": open");
  stream.cancel();

  expect(stream.text).toContain(": open");
});

test("the web review carries aligned rows with their line numbers", async () => {
  const payload = await toWebReview(review, config);

  expect(payload.id).toBe("id1");
  expect(payload.path).toBe("sample.ts");
  expect(payload.rows).toHaveLength(2);
  expect(payload.rows[0]?.kind).toBe("context");
  expect(payload.rows[1]?.kind).toBe("replace");
  expect(payload.rows[1]?.left).toBe("const b = 2;");
  expect(payload.rows[1]?.right).toBe("const b = 3;");
  expect(payload.rows[1]?.rightNumber).toBe(2);
});

// This is the whole web contract: a hook submits, the page answers, and the hook sees the questions.
test("a browser verdict travels back to the hook through the session socket", async () => {
  watcher = await startWebWatch({ directory: "/repo", port: 0, socketPath, token: TOKEN }, config);

  const transport = createSessionTransport(socketPath);
  const pending = transport.review(
    { tool: "edit", filePath: "sample.ts", before: review.before, after: review.after },
    config,
  );

  const stream = await readUntil(`${watcher.url}/events`, "event: review");
  const line = stream.text.split("\n").find((entry) => entry.startsWith("data: ")) ?? "";
  const payload: unknown = JSON.parse(line.slice("data: ".length));
  const id = isRecord(payload) && typeof payload["id"] === "string" ? payload["id"] : "";

  await fetch(`${watcher.url}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id,
      notes: [
        { startRow: 1, endRow: 1, pane: "right", startColumn: 0, endColumn: 12, text: "why 3?" },
      ],
    }),
  });

  const outcome = await pending;
  stream.cancel();

  expect(outcome).toEqual({
    reviewed: true,
    questions: [{ line: 2, code: "const b = 3;", text: "why 3?" }],
  });
});

test("a withdrawn review reaches an open viewer as a cancel frame and stops accepting a verdict", async () => {
  const seen: string[] = [];
  web = await startPlain((id) => seen.push(id));

  const viewer = await openViewer(`${web.url}/events`);
  await viewer.until(": open");

  web.offer(await toWebReview(review, config));
  await viewer.until("event: review");

  web.withdraw("id1");
  const text = await viewer.until("event: cancel");

  const response = await fetch(`${web.url}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "id1", notes: [] }),
  });

  viewer.cancel();

  expect(text).toContain("event: cancel");
  expect(text).toContain('{"id":"id1"}');
  expect(response.status).toBe(CONFLICT);
  expect(seen).toEqual([]);
});

test("a withdrawal naming an older review leaves the open one answerable", async () => {
  const seen: string[] = [];
  web = await startPlain((id) => seen.push(id));
  web.offer(await toWebReview(review, config));

  web.withdraw("stale");

  const response = await fetch(`${web.url}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "id1", notes: [] }),
  });

  expect(response.status).toBe(OK);
  expect(seen).toEqual(["id1"]);
});

test("an answered verdict tells every other viewer the review is gone", async () => {
  web = await startPlain(() => {});

  const viewer = await openViewer(`${web.url}/events`);
  await viewer.until(": open");

  web.offer(await toWebReview(review, config));
  await viewer.until("event: review");

  await fetch(`${web.url}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "id1", notes: [] }),
  });

  const text = await viewer.until("event: cancel");
  viewer.cancel();

  expect(text).toContain('event: cancel\ndata: {"id":"id1"}');
});

test("viewerCount counts the streams that are open", async () => {
  web = await startPlain(() => {});

  expect(web.viewerCount()).toBe(0);

  const viewer = await openViewer(`${web.url}/events`);
  await viewer.until(": open");

  expect(web.viewerCount()).toBe(1);

  viewer.cancel();
});

test("a body past the cap answers 413 rather than breaking the connection", async () => {
  const seen: string[] = [];
  web = await startPlain((id) => seen.push(id));

  const response = await fetch(`${web.url}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "x".repeat(2_000_000),
  });

  expect(response.status).toBe(PAYLOAD_TOO_LARGE);
  expect(seen).toEqual([]);
});

test("the page carries the client bundle inline and fetches nothing", async () => {
  web = await startPlain(() => {});

  const body = await (await fetch(web.url)).text();

  expect(body).toContain("var PairClient");
  expect(body).not.toContain("<script src=");
  expect(body).not.toContain("</script>\n<script");
});

test("renderPage never emits a closing script tag from inside the script", () => {
  const page = renderPage();
  const scripts = page.split("<script>").length - 1;

  expect(scripts).toBe(1);
  expect(page.split("</script>").length - 1).toBe(1);
});

test("renderPage links its duck favicon through the token path", () => {
  expect(renderPage()).toContain('<link rel="icon" type="image/png" href="favicon.png">');
});

test("renderPage stamps the split layout on the body when no layout is asked for", () => {
  expect(renderPage()).toContain('<body data-layout="split">');
});

test("renderPage stamps the layout it is given on the body", () => {
  expect(renderPage("inline")).toContain('<body data-layout="inline">');
});

test("renderPage presses the swap button that matches the layout", () => {
  const page = renderPage("inline");

  expect(page).toContain('<button data-layout="inline" aria-pressed="true">');
  expect(page).toContain('<button data-layout="split" aria-pressed="false">');
});

test("renderPage presses the split button for the default layout", () => {
  const page = renderPage();

  expect(page).toContain('<button data-layout="split" aria-pressed="true">');
  expect(page).toContain('<button data-layout="inline" aria-pressed="false">');
});

test("renderPage lays the page out as a header, a main and a footer", () => {
  const page = renderPage();

  expect(page).toContain("<header>");
  expect(page).toContain("<main>");
  expect(page).toContain("<footer>");
  expect(page).not.toContain("<aside");
});

test("renderPage gives main the leader canvas, the diff and the margin", () => {
  const page = renderPage();

  expect(page).toContain('id="leaders"');
  expect(page).toContain('id="diff"');
  expect(page).toContain('id="margin"');
});

test("the served page carries the layout the server was started with", async () => {
  web = await startWebServer({ port: 0, token: TOKEN, layout: "inline", onVerdict: () => {} });

  const body = await (await fetch(web.url)).text();

  expect(body).toContain('<body data-layout="inline">');
});

test("escapeHtml neutralises a closing script tag in file content", () => {
  expect(escapeHtml('</script><img onerror="x">')).toBe(
    "&lt;/script&gt;&lt;img onerror=&quot;x&quot;&gt;",
  );
});

test("escapeHtml escapes a lone ampersand and both quote characters", () => {
  expect(escapeHtml("a & b")).toBe("a &amp; b");
  expect(escapeHtml(`"quoted" 'single'`)).toBe("&quot;quoted&quot; &#39;single&#39;");
});

test("paintCell escapes hostile file content rather than emitting markup", () => {
  const painted = paintCell("</script><img src=x onerror=alert(1)>", [], []);

  expect(painted).not.toContain("<img");
  expect(painted).not.toContain("</script>");
  expect(painted).toContain("&lt;img");
});

test("paintCell drops a token colour that is not a hex colour", () => {
  const painted = paintCell("ab", [{ start: 0, end: 2, color: '"><img onerror=x>' }], []);

  expect(painted).toBe("ab");
  expect(painted).not.toContain("<img");
});

test("paintCell drops a token colour that is valid CSS but not a colour", () => {
  const colour = "red;background:url(https://attacker.example/pixel.png)";
  const painted = paintCell("abc", [{ start: 0, end: 3, color: colour }], []);

  expect(painted).toBe("abc");
  expect(painted).not.toContain("url(");
});

test("paintCell keeps a hex colour a theme actually emits", () => {
  const painted = paintCell("ab", [{ start: 0, end: 2, color: "#1e3a1e" }], []);

  expect(painted).toBe('<span style="color:#1e3a1e">ab</span>');
});

test("paintCell wraps a marked span and leaves the rest alone", () => {
  const painted = paintCell("abcd", [], [{ start: 1, end: 3 }]);

  expect(painted).toBe('a<mark class="noted">bc</mark>d');
});

test("columnIn measures the text between the cell start and the selection point", () => {
  const range: RangeLike = {
    selectNodeContents: () => {},
    setEnd: () => {},
    toString: () => "const b",
  };

  expect(columnIn(range, {}, {}, 7)).toBe(7);
});

test("draftRange refuses a selection that crosses panes or leaves the diff", () => {
  const left = { row: "1", pane: "left" };
  const right = { row: "1", pane: "right" };

  expect(draftRange(left, right, 0, 3)).toBe(null);
  expect(draftRange(null, right, 0, 3)).toBe(null);
  expect(draftRange({ row: "x", pane: "right" }, right, 0, 3)).toBe(null);
});

test("draftRange reads the row indices the cells carry", () => {
  const start = { row: "2", pane: "right" };
  const end = { row: "4", pane: "right" };

  expect(draftRange(start, end, 1, 6)).toEqual({
    startRow: 2,
    endRow: 4,
    pane: "right",
    startColumn: 1,
    endColumn: 6,
  });
});
