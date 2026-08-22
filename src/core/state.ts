import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import {
  existsSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";

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

export function flagPath(directory: string): string {
  const real = realpathLenient(directory);
  const digest = createHash("sha1").update(real).digest("hex").slice(0, 16);
  return join(stateDir(), `${digest}.on`);
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
