import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { sessionsDir } from "../../core/state";
import type { SessionKind, SessionRecord } from "../../core/state";
import { probeSession } from "../../transports/session";
import { isNullableString, isRecord, isString, removeQuietly } from "../../helpers";
import type { SessionListing, SessionProbe, SessionScan, SessionsResult } from "./sessions.types";

const UNKNOWN_LABEL = "unknown";
const UNKNOWN_AGE = "-";
const UNKNOWN_COUNT = "?";
const SESSION_KINDS: string[] = ["session", "directory"];

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function isSessionKind(value: unknown): value is SessionKind {
  return isString(value) && SESSION_KINDS.includes(value);
}

// Every field the type claims is checked, so nothing unvalidated reaches a listing through the narrowing.
function isSessionRecord(value: unknown): value is SessionRecord {
  if (!isRecord(value)) {
    return false;
  }

  if (!isString(value["id"]) || !isSessionKind(value["kind"])) {
    return false;
  }

  if (!isString(value["label"]) || !isString(value["directory"])) {
    return false;
  }

  if (!isNullableString(value["branch"]) || !isNullableString(value["agentSessionId"])) {
    return false;
  }

  if (!isNullableString(value["agentKind"]) || !isString(value["createdAt"])) {
    return false;
  }

  return typeof value["pid"] === "number";
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

// Only the files this socket owns are removed, so a session a person muted keeps its flag and its opt-out.
export function removeSession(id: string): void {
  [".sock", ".json", ".url"].forEach((extension) =>
    removeQuietly(join(sessionsDir(), `${id}${extension}`)),
  );
}

const FLAG_EXTENSIONS: string[] = [".on", ".off"];

// A session flag outlives the agent that wrote it, so a flag this old belongs to a session nobody can reach.
const FLAG_EXPIRY_MS = 14 * DAY_MS;

function flagFiles(): string[] {
  try {
    return readdirSync(sessionsDir())
      .filter((name) => FLAG_EXTENSIONS.some((extension) => name.endsWith(extension)))
      .filter((name) => name.startsWith("s-"))
      .sort();
  } catch {
    return [];
  }
}

function ageOf(path: string, now: number): number | null {
  try {
    return now - statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

// A flag whose session still has a socket is in use, so only a flag with no socket and no recent write expires.
export function sweepExpiredFlags(now: number = Date.now()): string[] {
  const expired: string[] = [];

  flagFiles().forEach((name) => {
    const id = name.replace(/\.(on|off)$/, "");

    if (existsSync(join(sessionsDir(), `${id}.sock`))) {
      return;
    }

    const path = join(sessionsDir(), name);
    const age = ageOf(path, now);

    if (age === null || age < FLAG_EXPIRY_MS) {
      return;
    }

    removeQuietly(path);
    expired.push(name);
  });

  return expired;
}

function kindOf(id: string, record: SessionRecord | null): SessionKind {
  if (record !== null) {
    return record.kind;
  }

  return id.startsWith("s-") ? "session" : "directory";
}

function toListing(id: string, probe: SessionProbe): SessionListing {
  const record = readRecord(id);
  const state = probe.status === "answered" ? probe.state : null;

  return {
    id,
    kind: kindOf(id, record),
    label: record?.label ?? UNKNOWN_LABEL,
    directory: record?.directory ?? "",
    clients: state?.clientCount ?? null,
    waiting: state?.waitingDepth ?? null,
    createdAt: record?.createdAt ?? "",
    alive: true,
  };
}

async function scan(): Promise<SessionScan> {
  const ids = sessionIds();
  const probes = await Promise.all(
    ids.map((id) => probeSession(join(sessionsDir(), `${id}.sock`))),
  );

  const listings: SessionListing[] = [];
  const swept: string[] = [];

  ids.forEach((id, index) => {
    const probe = probes[index];

    if (probe === undefined || probe.status === "refused") {
      removeSession(id);
      swept.push(id);
      return;
    }

    listings.push(toListing(id, probe));
  });

  // The socket sweep runs first, so a flag whose watcher just died is judged on its own age straight away.
  return { listings, swept, expired: sweepExpiredFlags() };
}

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

// A watcher too busy to answer has a real but unknown count, which reads as a question rather than a zero.
function formatCount(count: number | null): string {
  return count === null ? UNKNOWN_COUNT : String(count);
}

function formatTable(listings: SessionListing[], now: number): string {
  const header = ["ID", "LABEL", "KIND", "WATCHERS", "QUEUED", "AGE"];
  const rows = listings.map((entry) => [
    entry.id,
    entry.label,
    entry.kind,
    formatCount(entry.clients),
    formatCount(entry.waiting),
    formatAge(entry.createdAt, now),
  ]);

  const widths = header.map((name, column) =>
    Math.max(name.length, ...rows.map((row) => row[column]?.length ?? 0)),
  );

  const line = (cells: string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd();

  return [line(header), ...rows.map(line)].join("\n");
}

// A sweep deletes files from the state directory, so the count is always named rather than done quietly.
function sweptLine(swept: readonly string[]): string {
  const noun = swept.length === 1 ? "session" : "sessions";
  return `swept ${swept.length} dead ${noun}`;
}

// An expired flag is a file a person never sees, so the count says one went away.
function expiredLine(expired: readonly string[]): string {
  const noun = expired.length === 1 ? "flag" : "flags";
  return `expired ${expired.length} stale session ${noun}`;
}

export async function listSessions(): Promise<SessionsResult> {
  const { listings, swept, expired } = await scan();

  const table = listings.length === 0 ? "no pair-mode sessions" : formatTable(listings, Date.now());

  const notes = [
    ...(swept.length === 0 ? [] : [sweptLine(swept)]),
    ...(expired.length === 0 ? [] : [expiredLine(expired)]),
  ];

  const text = notes.length === 0 ? table : `${table}\n\n${notes.join("\n")}`;

  return { listings, swept, expired, text, exitCode: 0 };
}

export async function sweepDeadSessions(): Promise<string[]> {
  const { swept } = await scan();
  return swept;
}
