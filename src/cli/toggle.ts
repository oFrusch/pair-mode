import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  enable,
  disable,
  flagPath,
  sessionUrlPath,
  enableSession,
  optOutSession,
  sessionFlagState,
  isEnabled,
} from "../core/state";
import type { SessionKey } from "../core/state";
import { isRecord } from "../helpers";
import type { SessionLink } from "./toggle.types";

const POLL_MS = 100;
const POLL_ATTEMPTS = 60;

const SESSION_ENV_VARS = ["CLAUDE_CODE_SESSION_ID", "CODEX_SESSION_ID", "CODEX_THREAD_ID"];

// Only `pair-mode on` reads the environment, because it receives no hook payload to read instead.
export function agentSessionId(env: NodeJS.ProcessEnv): string | null {
  for (const name of SESSION_ENV_VARS) {
    const value = env[name];

    if (typeof value === "string" && value !== "") {
      return value;
    }
  }

  return null;
}

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

export function pairOn(directory: string, key?: SessionKey): string {
  if (key !== undefined) {
    enableSession(key);
    return `pair mode ON · ${key} · ${directory}`;
  }

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

export function pairOff(directory: string, key?: SessionKey): string {
  if (key !== undefined) {
    optOutSession(key);
    return `pair mode OFF · ${key}`;
  }

  disable(directory);
  const stopped = stopLink(directory);

  return stopped
    ? `pair mode OFF for ${directory} (web watcher stopped)`
    : `pair mode OFF for ${directory}`;
}

// A toggle reads the resolved state itself, so the caller needs no status check and no argument.
export async function pairToggle(
  directory: string,
  cliPath: string,
  web: boolean,
  key?: SessionKey,
): Promise<string> {
  const on = key === undefined ? existsSync(flagPath(directory)) : sessionFlagState(key) === "on";

  if (on) {
    return pairOff(directory, key);
  }

  if (web) {
    return await pairOnWeb(directory, cliPath);
  }

  return pairOn(directory, key);
}

export function pairStatus(directory: string, key?: SessionKey): string {
  const probe = join(directory, ".pair-mode-status-probe");
  const on = isEnabled(probe, key);
  const link = readLink(directory);
  const scope = key === undefined ? directory : `${key} · ${directory}`;
  const state = `pair mode ${on ? "ON" : "OFF"} for ${scope}`;

  return link === null ? state : `${state}\n${link.url}`;
}
