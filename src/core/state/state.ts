import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import { existsSync, realpathSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";

export function stateDir(): string {
  const base = process.env["XDG_STATE_HOME"] || join(homedir(), ".local", "state");
  return join(base, "pair-mode");
}

function realpathLenient(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);

    if (parent === path) {
      return path;
    }

    return join(realpathLenient(parent), basename(path));
  }
}

const DIGEST_LENGTH = 16;

function digestFor(directory: string): string {
  const real = realpathLenient(directory);
  return createHash("sha1").update(real).digest("hex").slice(0, DIGEST_LENGTH);
}

export function flagPath(directory: string): string {
  return join(stateDir(), `${digestFor(directory)}.on`);
}

export function sessionsDir(): string {
  return join(stateDir(), "sessions");
}

// The watcher and the hook both derive this from the directory, so neither side ever names a session id.
export function sessionSocketPath(directory: string): string {
  return join(sessionsDir(), `${digestFor(directory)}.sock`);
}

// A detached web watcher records its link here, so pair-mode on and off can find and stop it.
export function sessionUrlPath(directory: string): string {
  return join(sessionsDir(), `${digestFor(directory)}.url`);
}

// The watcher runs at the repo root, so the hook walks up from the edited file exactly as isEnabled does.
export function findSessionSocket(filePath: string): string | null {
  let current = dirname(realpathLenient(filePath));

  while (true) {
    const candidate = sessionSocketPath(current);

    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(current);

    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

export function isEnabled(filePath: string): boolean {
  let current = dirname(realpathLenient(filePath));

  while (true) {
    if (existsSync(flagPath(current))) {
      return true;
    }

    const parent = dirname(current);

    if (parent === current) {
      return false;
    }

    current = parent;
  }
}

export function enable(directory: string): string {
  const path = flagPath(directory);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
  return path;
}

export function disable(directory: string): boolean {
  const path = flagPath(directory);

  if (!existsSync(path)) {
    return false;
  }

  unlinkSync(path);
  return true;
}
