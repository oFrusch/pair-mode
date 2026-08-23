import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HookEntry, HookGroup, RegisterResult } from "./register.types";
import { isRecord } from "../helpers";

const HOOK_TIMEOUT_SECONDS = 1800;

function isHookEntry(value: unknown): value is HookEntry {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value["type"] !== "string") {
    return false;
  }

  if (typeof value["command"] !== "string") {
    return false;
  }

  if ("timeout" in value && typeof value["timeout"] !== "number") {
    return false;
  }

  return true;
}

function isHookGroup(value: unknown): value is HookGroup {
  if (!isRecord(value)) {
    return false;
  }

  if (!("hooks" in value) || !Array.isArray(value["hooks"])) {
    return false;
  }

  if ("matcher" in value && typeof value["matcher"] !== "string") {
    return false;
  }

  return value["hooks"].every(isHookEntry);
}

// Every file this module touches is a plain JSON object at the root. A file that is not gets a clear error rather than a silent overwrite.
function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }

  const text = readFileSync(path, "utf-8");
  const parsed: unknown = JSON.parse(text);

  if (!isRecord(parsed)) {
    throw new Error(`${path} does not contain a JSON object`);
  }

  return parsed;
}

// Never overwrite a user file without a backup of what was there first.
export function backupIfPresent(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }

  const backupPath = `${path}.pair-backup`;
  copyFileSync(path, backupPath);
  return backupPath;
}

// A shape this module cannot safely coerce: overwriting it with {} or [] would destroy whatever the user put there.
function describeShapeError(root: Record<string, unknown>, path: string): string | null {
  if ("hooks" in root && !isRecord(root["hooks"])) {
    const found = Array.isArray(root["hooks"]) ? "an array" : typeof root["hooks"];
    return `${path}: "hooks" must be an object, found ${found}. Fix it by hand, then re-run this command.`;
  }

  const hooks = root["hooks"];

  if (isRecord(hooks) && "PreToolUse" in hooks && !Array.isArray(hooks["PreToolUse"])) {
    const found = typeof hooks["PreToolUse"];
    return `${path}: "hooks.PreToolUse" must be an array, found ${found}. Fix it by hand, then re-run this command.`;
  }

  return null;
}

function preToolUseGroups(root: Record<string, unknown>): unknown[] {
  const hooksValue = root["hooks"];
  const hooks: Record<string, unknown> = isRecord(hooksValue) ? hooksValue : {};
  root["hooks"] = hooks;

  const groupsValue = hooks["PreToolUse"];
  const groups: unknown[] = Array.isArray(groupsValue) ? groupsValue : [];
  hooks["PreToolUse"] = groups;

  return groups;
}

function hasCommand(groups: unknown[], command: string): boolean {
  return groups.some((group) => {
    if (!isHookGroup(group)) {
      return false;
    }

    return group.hooks.some((entry) => entry.command === command);
  });
}

function writeJsonObject(path: string, root: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(root, null, 2) + "\n", "utf-8");
}

function registerPreToolUseHook(
  path: string,
  matcher: string,
  command: string,
  timeout: number,
): RegisterResult {
  const root = readJsonObject(path);
  const shapeError = describeShapeError(root, path);

  if (shapeError !== null) {
    return { path, changed: false, backupPath: null, error: shapeError };
  }

  const groups = preToolUseGroups(root);

  if (hasCommand(groups, command)) {
    return { path, changed: false, backupPath: null };
  }

  const backupPath = backupIfPresent(path);
  groups.push({ matcher, hooks: [{ type: "command", command, timeout }] });
  writeJsonObject(path, root);

  return { path, changed: true, backupPath };
}

export function isPreToolUseRegistered(path: string, command: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  let root: Record<string, unknown>;

  try {
    root = readJsonObject(path);
  } catch {
    return false;
  }

  return hasCommand(preToolUseGroups(root), command);
}

export function claudeCodeSettingsPath(homeDir: string): string {
  return join(homeDir, ".claude", "settings.json");
}

export function registerClaudeCode(homeDir: string, installRoot: string): RegisterResult {
  const path = claudeCodeSettingsPath(homeDir);
  const command = join(installRoot, "dist", "claude-code.js");
  return registerPreToolUseHook(path, "Write|Edit|MultiEdit", command, HOOK_TIMEOUT_SECONDS);
}

export function codexHooksPath(homeDir: string): string {
  return join(homeDir, ".codex", "hooks.json");
}

export function registerCodex(homeDir: string, installRoot: string): RegisterResult {
  const path = codexHooksPath(homeDir);
  const command = join(installRoot, "dist", "codex.js");
  return registerPreToolUseHook(path, "apply_patch|Edit|Write", command, HOOK_TIMEOUT_SECONDS);
}

// Codex has no MultiEdit alias, so a matcher carrying that token matches nothing there.
export function findMultiEditMatchers(homeDir: string): string[] {
  const path = codexHooksPath(homeDir);

  if (!existsSync(path)) {
    return [];
  }

  const root = readJsonObject(path);
  const groups = preToolUseGroups(root);
  const matchers: string[] = [];

  for (const group of groups) {
    if (!isHookGroup(group) || group.matcher === undefined) {
      continue;
    }

    if (group.matcher.split("|").includes("MultiEdit")) {
      matchers.push(group.matcher);
    }
  }

  return matchers;
}

export function correctMultiEditMatchers(homeDir: string): RegisterResult {
  const path = codexHooksPath(homeDir);
  const root = readJsonObject(path);
  const shapeError = describeShapeError(root, path);

  if (shapeError !== null) {
    return { path, changed: false, backupPath: null, error: shapeError };
  }

  const groups = preToolUseGroups(root);
  let changed = false;
  const droppedMatchers: string[] = [];
  const next: unknown[] = [];

  for (const group of groups) {
    if (!isHookGroup(group) || group.matcher === undefined) {
      next.push(group);
      continue;
    }

    const tokens = group.matcher.split("|");
    const kept = tokens.filter((token) => token !== "MultiEdit");

    if (kept.length === tokens.length) {
      next.push(group);
      continue;
    }

    changed = true;

    // Stripping every token would leave a matcher of "", which matches every tool. Drop the whole group instead.
    if (kept.length === 0) {
      droppedMatchers.push(group.matcher);
      continue;
    }

    group.matcher = kept.join("|");
    next.push(group);
  }

  if (!changed) {
    return { path, changed: false, backupPath: null };
  }

  groups.length = 0;
  groups.push(...next);

  const backupPath = backupIfPresent(path);
  writeJsonObject(path, root);

  const note =
    droppedMatchers.length > 0
      ? `removed ${droppedMatchers.length} hook group(s) whose matcher would otherwise have become empty and matched every tool: ${droppedMatchers.join(", ")}`
      : undefined;

  return { path, changed: true, backupPath, note };
}

function writeReExport(path: string, target: string): RegisterResult {
  const content = `export * from "${target}";\n`;

  if (existsSync(path) && readFileSync(path, "utf-8") === content) {
    return { path, changed: false, backupPath: null };
  }

  const backupPath = backupIfPresent(path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");

  return { path, changed: true, backupPath };
}

export function isReExportRegistered(path: string, target: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  return readFileSync(path, "utf-8").includes(target);
}

export function opencodePluginPath(homeDir: string): string {
  return join(homeDir, ".config", "opencode", "plugin", "pair-mode.ts");
}

export function registerOpencode(homeDir: string, installRoot: string): RegisterResult {
  const target = join(installRoot, "dist", "opencode.js");
  return writeReExport(opencodePluginPath(homeDir), target);
}

export function piExtensionPath(homeDir: string): string {
  return join(homeDir, ".pi", "agent", "extensions", "pair-mode.ts");
}

export function registerPi(homeDir: string, installRoot: string): RegisterResult {
  const target = join(installRoot, "dist", "pi.js");
  return writeReExport(piExtensionPath(homeDir), target);
}
