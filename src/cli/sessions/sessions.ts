import { createConnection } from "node:net";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { sessionsDir } from "../../core/state";
import type { SessionKind, SessionRecord } from "../../core/state";
import { createLineReader, decodeLine, encode } from "../../transports/session";
import type { StateMessage } from "../../transports/session";
import { removeQuietly, isRecord } from "../../helpers";
import type { SessionListing, SessionsResult } from "./sessions.types";

const STATUS_TIMEOUT_MS = 250;
const UNKNOWN_LABEL = "unknown";
const UNKNOWN_AGE = "-";

// A socket that answers a status request is live. Anything else is a file a crashed watcher left behind.
function askStatus(socketPath: string): Promise<StateMessage | null> {
  return new Promise((resolve) => {
    let settled = false;

    const settle = (state: StateMessage | null): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(state);
    };

    const timer = setTimeout(() => settle(null), STATUS_TIMEOUT_MS);

    const socket = createConnection(socketPath);
    socket.setEncoding("utf-8");

    const readLines = createLineReader();

    socket.on("error", () => settle(null));
    socket.on("close", () => settle(null));

    socket.on("data", (chunk: string) => {
      readLines(chunk).forEach((line) => {
        const message = decodeLine(line);

        if (message?.type === "state") {
          settle(message);
        }
      });
    });

    socket.on("connect", () => socket.write(encode({ type: "status" })));
  });
}

function isSessionRecord(value: unknown): value is SessionRecord {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value["label"] === "string" && typeof value["directory"] === "string";
}

// A malformed sidecar must never hide a live socket, so a failed read degrades to an unknown label.
function readRecord(id: string): SessionRecord | null {
  const path = join(sessionsDir(), `${id}.json`);

  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return isSessionRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sessionIds(): string[] {
  try {
    return readdirSync(sessionsDir())
      .filter((name) => name.endsWith(".sock"))
      .map((name) => basename(name, ".sock"))
      .sort();
  } catch {
    return [];
  }
}

// Only the files this socket owns are removed, so a neighbouring live session keeps all of its state.
function removeSession(id: string): void {
  [".sock", ".json", ".url"].forEach((extension) =>
    removeQuietly(join(sessionsDir(), `${id}${extension}`)),
  );
}

function kindOf(id: string, record: SessionRecord | null): SessionKind {
  if (record !== null) {
    return record.kind;
  }

  return id.startsWith("s-") ? "session" : "directory";
}

function toListing(id: string, state: StateMessage): SessionListing {
  const record = readRecord(id);

  return {
    id,
    kind: kindOf(id, record),
    label: record?.label ?? UNKNOWN_LABEL,
    directory: record?.directory ?? "",
    clients: state.clientCount,
    waiting: state.waitingDepth,
    createdAt: record?.createdAt ?? "",
    alive: true,
  };
}

async function scan(): Promise<{ listings: SessionListing[]; swept: string[] }> {
  const ids = sessionIds();
  const states = await Promise.all(ids.map((id) => askStatus(join(sessionsDir(), `${id}.sock`))));

  const listings: SessionListing[] = [];
  const swept: string[] = [];

  ids.forEach((id, index) => {
    const state = states[index];

    if (state === undefined || state === null) {
      removeSession(id);
      swept.push(id);
      return;
    }

    listings.push(toListing(id, state));
  });

  return { listings, swept };
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// A person scans the age, so the largest whole unit is the only one worth printing.
function formatAge(createdAt: string, now: number): string {
  const started = Date.parse(createdAt);

  if (Number.isNaN(started)) {
    return UNKNOWN_AGE;
  }

  const elapsed = Math.max(0, now - started);

  if (elapsed >= DAY_MS) {
    return `${Math.floor(elapsed / DAY_MS)}d`;
  }

  if (elapsed >= HOUR_MS) {
    return `${Math.floor(elapsed / HOUR_MS)}h`;
  }

  if (elapsed >= MINUTE_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)}m`;
  }

  return `${Math.floor(elapsed / SECOND_MS)}s`;
}

function formatTable(listings: SessionListing[], now: number): string {
  const header = ["ID", "LABEL", "KIND", "WATCHERS", "QUEUED", "AGE"];
  const rows = listings.map((entry) => [
    entry.id,
    entry.label,
    entry.kind,
    String(entry.clients),
    String(entry.waiting),
    formatAge(entry.createdAt, now),
  ]);

  const widths = header.map((name, column) =>
    Math.max(name.length, ...rows.map((row) => row[column]?.length ?? 0)),
  );

  const line = (cells: string[]): string =>
    cells
      .map((cell, column) => pad(cell, widths[column] ?? 0))
      .join("  ")
      .trimEnd();

  return [line(header), ...rows.map(line)].join("\n");
}

export async function listSessions(): Promise<SessionsResult> {
  const { listings, swept } = await scan();

  const text = listings.length === 0 ? "no pair-mode sessions" : formatTable(listings, Date.now());

  return { listings, swept, text, exitCode: 0 };
}

export async function sweepDeadSessions(): Promise<string[]> {
  const { swept } = await scan();
  return swept;
}
