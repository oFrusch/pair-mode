import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isRecord } from "../helpers";
import { renderPage } from "./page";
import { webNotesToQuestions } from "./notes";
import type { WebNote } from "./notes.types";
import type { WebReview } from "./review.types";
import type { BodyResult, WebServer, WebServerOptions } from "./server.types";

const HOST = "127.0.0.1";
const TOKEN_BYTES = 16;
const MAX_BODY_BYTES = 1_000_000;

// The build copies assets next to dist, and a source run reads them one level higher.
function readAsset(name: string): Buffer {
  const bundled = fileURLToPath(new URL(`../assets/${name}`, import.meta.url));
  const source = fileURLToPath(new URL(`../../assets/${name}`, import.meta.url));
  return readFileSync(existsSync(bundled) ? bundled : source);
}

const IMAGES: Record<string, Buffer> = {
  "favicon.png": readAsset("favicon.png"),
  "duck.png": readAsset("duck.png"),
};

const NOT_FOUND = 404;
const OK = 200;
const BAD_REQUEST = 400;
const PAYLOAD_TOO_LARGE = 413;
const CONFLICT = 409;

// server.address() widens to string | AddressInfo | null, and only the object form carries a port.
function portOf(address: unknown): number {
  return isRecord(address) && typeof address["port"] === "number" ? address["port"] : 0;
}

function defaultToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

// A wrong token always returns 404. A 403 would confirm the token space to whoever guessed the route.
function notFound(response: ServerResponse): void {
  response.writeHead(NOT_FOUND, { "content-type": "text/plain" });
  response.end("not found\n");
}

const PANES: string[] = ["left", "right"];

function isIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isWebNote(value: unknown): value is WebNote {
  if (!isRecord(value)) {
    return false;
  }

  const pane = value["pane"];

  if (typeof pane !== "string" || !PANES.includes(pane)) {
    return false;
  }

  return (
    isIndex(value["startRow"]) &&
    isIndex(value["endRow"]) &&
    isIndex(value["startColumn"]) &&
    isIndex(value["endColumn"]) &&
    typeof value["text"] === "string"
  );
}

// The cap is named in bytes, so the chunks stay buffers until the whole body is known to fit.
function readBody(request: IncomingMessage): Promise<BodyResult> {
  return new Promise((resolve) => {
    let chunks: Buffer[] = [];
    let size = 0;
    let done = false;

    function settle(result: BodyResult): void {
      if (done) {
        return;
      }

      done = true;
      chunks = [];
      resolve(result);
    }

    // The rest of an oversized upload is drained and dropped, because a paused socket would never close.
    request.on("data", (chunk: Buffer) => {
      if (done) {
        return;
      }

      size += chunk.byteLength;

      if (size > MAX_BODY_BYTES) {
        settle({ kind: "too-large" });
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => settle({ kind: "ok", body: Buffer.concat(chunks).toString("utf-8") }));
    request.on("error", () => settle({ kind: "error" }));
  });
}

// The page posts note ranges rather than finished questions, so one span suffix rule serves every client.
function parseVerdict(body: string): { id: string; notes: WebNote[] } | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed["id"] !== "string") {
    return null;
  }

  const notes = parsed["notes"];

  if (!Array.isArray(notes) || !notes.every(isWebNote)) {
    return null;
  }

  return { id: parsed["id"], notes };
}

export function startWebServer(options: WebServerOptions): Promise<WebServer> {
  const token = options.token ?? defaultToken();
  const base = `/r/${token}`;
  const viewers = new Set<ServerResponse>();

  // Broadcast can queue two edits before either verdict, so the pending reviews wait in order.
  let pending: WebReview[] = [];

  function sendEvent(response: ServerResponse, event: string, data: string): void {
    response.write(`event: ${event}\ndata: ${data}\n\n`);
  }

  function openStream(response: ServerResponse): void {
    response.writeHead(OK, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    // Node holds headers until the first body write, so a viewer waiting for the first event would stall.
    response.flushHeaders();
    response.write(": open\n\n");

    viewers.add(response);
    response.on("close", () => viewers.delete(response));

    const open = pending[0];

    // A viewer that joins mid-review sees it at once rather than waiting for the next one.
    if (open !== undefined) {
      sendEvent(response, "review", JSON.stringify(open));
    }
  }

  function broadcastCancel(id: string): void {
    const data = JSON.stringify({ id });
    viewers.forEach((viewer) => sendEvent(viewer, "cancel", data));
  }

  function broadcastReview(review: WebReview): void {
    const data = JSON.stringify(review);
    viewers.forEach((viewer) => sendEvent(viewer, "review", data));
  }

  // The browser shows one review at a time, so the next pending review opens only once this one ends.
  function retire(id: string): void {
    const wasOpen = pending[0]?.id === id;

    pending = pending.filter((review) => review.id !== id);
    broadcastCancel(id);

    const next = pending[0];

    if (wasOpen && next !== undefined) {
      broadcastReview(next);
    }
  }

  async function handleVerdict(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const result = await readBody(request);

    // Destroying the request instead would hand the client a broken pipe in place of the status.
    if (result.kind === "too-large") {
      response.writeHead(PAYLOAD_TOO_LARGE).end();
      return;
    }

    if (result.kind === "error") {
      response.writeHead(BAD_REQUEST).end();
      return;
    }

    const verdict = parseVerdict(result.body);

    if (verdict === null) {
      response.writeHead(BAD_REQUEST).end();
      return;
    }

    const answered = pending[0];

    // A verdict naming any other review would strand the open one, so a stale page click is refused.
    if (answered === undefined || answered.id !== verdict.id) {
      response.writeHead(CONFLICT, { "content-type": "application/json" }).end("{}");
      return;
    }

    // A second tab still shows this review, so it learns the answer landed before its own notes are lost.
    retire(verdict.id);
    options.onVerdict(verdict.id, webNotesToQuestions(answered, verdict.notes));
    response.writeHead(OK, { "content-type": "application/json" }).end("{}");
  }

  function handle(request: IncomingMessage, response: ServerResponse): void {
    const url = request.url ?? "";

    if (url === base && request.method === "GET") {
      response.writeHead(OK, { "content-type": "text/html; charset=utf-8" });
      response.end(renderPage(options.layout, base));
      return;
    }

    const image = url.startsWith(`${base}/`) ? IMAGES[url.slice(base.length + 1)] : undefined;

    if (image !== undefined && request.method === "GET") {
      response.writeHead(OK, { "content-type": "image/png" });
      response.end(image);
      return;
    }

    if (url === `${base}/events` && request.method === "GET") {
      openStream(response);
      return;
    }

    if (url === `${base}/verdict` && request.method === "POST") {
      void handleVerdict(request, response);
      return;
    }

    notFound(response);
  }

  const server = createServer(handle);

  return new Promise((resolve, reject) => {
    server.once("error", reject);

    server.listen(options.port, HOST, () => {
      server.removeListener("error", reject);

      const port = portOf(server.address());

      resolve({
        url: `http://${HOST}:${port}${base}`,
        port,
        token,

        viewerCount(): number {
          return viewers.size;
        },

        offer(review: WebReview): void {
          pending = [...pending, review];

          if (pending.length === 1) {
            broadcastReview(review);
          }
        },

        // A withdrawal for an older review must leave the one now open alone.
        withdraw(id: string): void {
          retire(id);
        },

        close(): Promise<void> {
          return new Promise((done) => {
            viewers.forEach((viewer) => viewer.end());
            viewers.clear();
            pending = [];
            server.close(() => done());
          });
        },
      });
    });
  });
}
