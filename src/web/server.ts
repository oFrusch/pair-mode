import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { isRecord } from "../helpers";
import type { Question } from "../core/collect";
import { renderPage } from "./page";
import { webNotesToQuestions } from "./notes";
import type { WebNote } from "./notes.types";
import type { WebReview } from "./review.types";
import type { WebServer, WebServerOptions } from "./server.types";

const HOST = "127.0.0.1";
const TOKEN_BYTES = 16;
const MAX_BODY_BYTES = 1_000_000;

const NOT_FOUND = 404;
const OK = 200;
const BAD_REQUEST = 400;
const PAYLOAD_TOO_LARGE = 413;

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

function readBody(request: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    let size = 0;

    request.setEncoding("utf-8");

    request.on("data", (chunk: string) => {
      size += chunk.length;

      if (size > MAX_BODY_BYTES) {
        resolve(null);
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => resolve(chunks.join("")));
    request.on("error", () => resolve(null));
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

  let current: WebReview | null = null;

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

    // A viewer that joins mid-review sees it at once rather than waiting for the next one.
    if (current !== null) {
      sendEvent(response, "review", JSON.stringify(current));
    }
  }

  async function handleVerdict(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readBody(request);

    if (body === null) {
      response.writeHead(PAYLOAD_TOO_LARGE).end();
      return;
    }

    const verdict = parseVerdict(body);

    if (verdict === null) {
      response.writeHead(BAD_REQUEST).end();
      return;
    }

    const answered = current;
    current = null;

    const questions: Question[] =
      answered === null ? [] : webNotesToQuestions(answered, verdict.notes);

    options.onVerdict(verdict.id, questions);
    response.writeHead(OK, { "content-type": "application/json" }).end("{}");
  }

  function handle(request: IncomingMessage, response: ServerResponse): void {
    const url = request.url ?? "";

    if (url === base && request.method === "GET") {
      response.writeHead(OK, { "content-type": "text/html; charset=utf-8" });
      response.end(renderPage());
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
          current = review;
          const data = JSON.stringify(review);
          viewers.forEach((viewer) => sendEvent(viewer, "review", data));
        },

        withdraw(id: string): void {
          current = null;
          viewers.forEach((viewer) => sendEvent(viewer, "cancel", JSON.stringify({ id })));
        },

        close(): Promise<void> {
          return new Promise((done) => {
            viewers.forEach((viewer) => viewer.end());
            viewers.clear();
            server.close(() => done());
          });
        },
      });
    });
  });
}
