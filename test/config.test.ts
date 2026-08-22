import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, beforeEach, afterEach } from "vitest";
import { DEFAULT_CONFIG, configPath, loadConfig, saveConfig } from "../src/core/config";

let xdgConfigHome: string;
let originalXdgConfigHome: string | undefined;

beforeEach(() => {
  xdgConfigHome = mkdtempSync(join(tmpdir(), "pair-mode-config-"));
  originalXdgConfigHome = process.env["XDG_CONFIG_HOME"];
  process.env["XDG_CONFIG_HOME"] = xdgConfigHome;
});

afterEach(() => {
  if (originalXdgConfigHome === undefined) {
    delete process.env["XDG_CONFIG_HOME"];
  } else {
    process.env["XDG_CONFIG_HOME"] = originalXdgConfigHome;
  }
});

test("configPath honours XDG_CONFIG_HOME", () => {
  expect(configPath()).toBe(join(xdgConfigHome, "pair-mode", "config.json"));
});

test("absent config file yields the defaults and no errors", () => {
  const result = loadConfig(join(xdgConfigHome, "missing.json"));

  expect(result.config).toEqual(DEFAULT_CONFIG);
  expect(result.errors).toEqual([]);
});

test("malformed JSON yields the defaults and one error", () => {
  const path = join(xdgConfigHome, "bad.json");
  writeFileSync(path, "{ not json", "utf-8");

  const result = loadConfig(path);

  expect(result.config).toEqual(DEFAULT_CONFIG);
  expect(result.errors).toHaveLength(1);
});

test("context: 0 falls back to 5 and reports one error naming context", () => {
  const path = join(xdgConfigHome, "context.json");
  writeFileSync(path, JSON.stringify({ context: 0 }), "utf-8");

  const result = loadConfig(path);

  expect(result.config.context).toBe(5);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]?.path).toBe("context");
});

test("theme.add: red falls back and reports one error naming theme.add", () => {
  const path = join(xdgConfigHome, "theme.json");
  writeFileSync(path, JSON.stringify({ theme: { add: "red" } }), "utf-8");

  const result = loadConfig(path);

  expect(result.config.theme.add).toBe(DEFAULT_CONFIG.theme.add);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]?.path).toBe("theme.add");
});

test("editor as a non-empty string array validates", () => {
  const path = join(xdgConfigHome, "editor.json");
  writeFileSync(path, JSON.stringify({ editor: ["kak", "-e", "x"] }), "utf-8");

  const result = loadConfig(path);

  expect(result.config.editor).toEqual(["kak", "-e", "x"]);
  expect(result.errors).toEqual([]);
});

test("saveConfig then loadConfig round-trips", () => {
  const path = join(xdgConfigHome, "nested", "config.json");
  const custom = {
    ...DEFAULT_CONFIG,
    editor: "nvim" as const,
    context: 8,
    trace: true,
  };

  saveConfig(custom, path);
  const result = loadConfig(path);

  expect(result.config).toEqual(custom);
  expect(result.errors).toEqual([]);
});

test("saveConfig creates the parent directory", () => {
  const dir = join(xdgConfigHome, "deep", "nested", "dir");
  const path = join(dir, "config.json");

  saveConfig(DEFAULT_CONFIG, path);

  expect(() => mkdirSync(dir, { recursive: true })).not.toThrow();
});
