import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  keyFor,
  enable,
  disable,
  watchUrlPath,
  enableSession,
  optOutSession,
  isEnabled,
  flagPath,
} from "../core/state";
import type { SessionKey } from "../core/state";
import { isRecord } from "../helpers";
import type { SessionLink } from "./toggle.types";

const POLL_MS = 100;
const POLL_ATTEMPTS = 60;

const SESSION_ENV_VARS = ["CLAUDE_CODE_SESSION_ID", "CODEX_SESSION_ID", "CODEX_THREAD_ID"];

// Only `pair-mode on` reads the environment, because it receives no hook payload to read instead.
export function agentSessionId(env: NodeJS.ProcessEnv): string | null {
  const found = SESSION_ENV_VARS.map((name) => env[name]).find(
    (value) => typeof value === "string" && value !== "",
  );

  return found ?? null;
}

// A plain terminal has no session id, so the caller keeps the directory scope and behaves as it always has.
export function currentSessionKey(): SessionKey | undefined {
  return keyFor(agentSessionId(process.env) ?? undefined);
}

// isEnabled walks up from a file, so both the status and the toggle name a file inside the directory they mean.
function statusProbe(directory: string): string {
  return join(directory, ".pair-mode-status-probe");
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

// A session-scoped web watcher publishes its link beside its own socket, not beside the directory socket.
function readLink(directory: string, key?: SessionKey): SessionLink | null {
  const path = watchUrlPath(directory, key);

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
async function waitForLink(directory: string, key?: SessionKey): Promise<SessionLink | null> {
  const attempts = Array.from({ length: POLL_ATTEMPTS }, (_, index) => index);

  for (const _attempt of attempts) {
    const link = readLink(directory, key);

    if (link !== null) {
      return link;
    }

    await sleep(POLL_MS);
  }

  return null;
}

function stopLink(directory: string, key?: SessionKey): boolean {
  const link = readLink(directory, key);

  if (link === null) {
    return false;
  }

  try {
    process.kill(link.pid, "SIGTERM");
  } catch {
    // The watcher is already gone, so only its link file needs clearing.
  }

  try {
    unlinkSync(watchUrlPath(directory, key));
  } catch {
    // Best-effort cleanup only.
  }

  return true;
}

// The web path is the same command as the plain one, so both report the scope they turned on the same way.
function onHeadline(directory: string, key?: SessionKey): string {
  return key ? `pair mode ON · ${key} · ${directory}` : `pair mode ON for ${directory}`;
}

export function pairOn(directory: string, key?: SessionKey): string {
  if (key) {
    enableSession(key);
  } else {
    enable(directory);
  }

  return onHeadline(directory, key);
}

// A web watcher needs no TTY, so a slash command inside an agent can start one and read back the link.
export async function pairOnWeb(
  directory: string,
  cliPath: string,
  key?: SessionKey,
): Promise<string> {
  const headline = onHeadline(directory, key);

  if (key) {
    enableSession(key);
  } else {
    enable(directory);
  }

  const existing = readLink(directory, key);

  if (existing !== null) {
    return `${headline}\n${existing.url}`;
  }

  const target = key ?? directory;

  const child = spawn(process.execPath, [cliPath, "watch", "--web", target], {
    cwd: directory,
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  const link = await waitForLink(directory, key);

  if (link === null) {
    return `${headline}\nthe web watcher did not report a link`;
  }

  return `${headline}\n${link.url}`;
}

export function pairOff(directory: string, key?: SessionKey): string {
  if (key) {
    optOutSession(key);
    const stopped = stopLink(directory, key);

    return stopped ? `pair mode OFF · ${key} (web watcher stopped)` : `pair mode OFF · ${key}`;
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
  // A session with no flag of its own still sees a directory flag; a plain directory toggle checks only its own path.
  const on = key ? isEnabled(statusProbe(directory), key) : existsSync(flagPath(directory));

  if (on) {
    return pairOff(directory, key);
  }

  if (web) {
    return await pairOnWeb(directory, cliPath, key);
  }

  return pairOn(directory, key);
}

export function pairStatus(directory: string, key?: SessionKey): string {
  const on = isEnabled(statusProbe(directory), key);
  const link = readLink(directory, key);
  const scope = key ? `${key} · ${directory}` : directory;
  const state = `pair mode ${on ? "ON" : "OFF"} for ${scope}`;

  return link === null ? state : `${state}\n${link.url}`;
}
