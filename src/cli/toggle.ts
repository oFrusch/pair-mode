import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { enable, disable, flagPath, sessionUrlPath } from "../core/state";
import { isRecord } from "../helpers";
import type { SessionLink } from "./toggle.types";

const POLL_MS = 100;
const POLL_ATTEMPTS = 60;

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function readLink(directory: string): SessionLink | null {
  const path = sessionUrlPath(directory);

  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));

    if (
      isRecord(parsed) &&
      typeof parsed["url"] === "string" &&
      typeof parsed["pid"] === "number"
    ) {
      return { url: parsed["url"], pid: parsed["pid"] };
    }
  } catch {
    return null;
  }

  return null;
}

// The watcher writes its link once the server is listening, so the parent polls rather than guessing a delay.
async function waitForLink(directory: string): Promise<SessionLink | null> {
  const attempts = Array.from({ length: POLL_ATTEMPTS }, (_, index) => index);

  for (const _attempt of attempts) {
    const link = readLink(directory);

    if (link !== null) {
      return link;
    }

    await sleep(POLL_MS);
  }

  return null;
}

function stopLink(directory: string): boolean {
  const link = readLink(directory);

  if (link === null) {
    return false;
  }

  try {
    process.kill(link.pid, "SIGTERM");
  } catch {
    // The watcher is already gone, so only its link file needs clearing.
  }

  try {
    unlinkSync(sessionUrlPath(directory));
  } catch {
    // Best-effort cleanup only.
  }

  return true;
}

export function pairOn(directory: string): string {
  enable(directory);
  return `pair mode ON for ${directory}`;
}

// A web watcher needs no TTY, so a slash command inside an agent can start one and read back the link.
export async function pairOnWeb(directory: string, cliPath: string): Promise<string> {
  enable(directory);

  const existing = readLink(directory);

  if (existing !== null) {
    return `pair mode ON for ${directory}\n${existing.url}`;
  }

  const child = spawn(process.execPath, [cliPath, "watch", "--web", directory], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  const link = await waitForLink(directory);

  if (link === null) {
    return `pair mode ON for ${directory}\nthe web watcher did not report a link`;
  }

  return `pair mode ON for ${directory}\n${link.url}`;
}

export function pairOff(directory: string): string {
  disable(directory);
  const stopped = stopLink(directory);

  return stopped
    ? `pair mode OFF for ${directory} (web watcher stopped)`
    : `pair mode OFF for ${directory}`;
}

export function pairStatus(directory: string): string {
  const on = existsSync(flagPath(directory));
  const link = readLink(directory);
  const state = `pair mode ${on ? "ON" : "OFF"} for ${directory}`;

  return link === null ? state : `${state}\n${link.url}`;
}
