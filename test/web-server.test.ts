import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, beforeEach, afterEach } from "vitest";
import { startWebServer, startWebWatch, toWebReview } from "../src/web";
import type { WebServer, WebWatcher } from "../src/web";
import { DEFAULT_CONFIG } from "../src/core/config";
import type { PairConfig } from "../src/core/config";
import type { Question } from "../src/core/collect";
import type { ReviewMessage } from "../src/transports/session";
import { createSessionTransport } from "../src/transports/session";
import { isRecord } from "../src/helpers";

const TOKEN = "0123456789abcdef0123456789abcdef";
const OK = 200;
const NOT_FOUND = 404;
const BAD_REQUEST = 400;
const CONFLICT = 409;

let web: WebServer | null = null;
let watcher: WebWatcher | null = null;
let socketPath: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "pair-web-"));
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

test("the review page loads at the token path", async () => {
  web = await startPlain(() => {});

  const response = await fetch(web.url);
  const body = await response.text();

  expect(response.status).toBe(OK);
  expect(body).toContain("<title>pair mode</title>");
  expect(body).toContain('id="diff"');
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
