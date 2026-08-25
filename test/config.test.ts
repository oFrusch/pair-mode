import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "vitest";
import { DEFAULT_CONFIG, configPath, loadConfig, saveConfig } from "../src/core/config";
import { useIsolatedHome } from "./helpers/env";

const isolated = useIsolatedHome();

test("configPath honours XDG_CONFIG_HOME", () => {
  expect(configPath()).toBe(join(isolated.configHome, "pair-mode", "config.json"));
});

test("absent config file yields the defaults and no errors", () => {
  const result = loadConfig(join(isolated.configHome, "missing.json"));

  expect(result.config).toEqual(DEFAULT_CONFIG);
  expect(result.errors).toEqual([]);
});

test("malformed JSON yields the defaults and one error", () => {
  const path = join(isolated.configHome, "bad.json");
  writeFileSync(path, "{ not json", "utf-8");

  const result = loadConfig(path);

  expect(result.config).toEqual(DEFAULT_CONFIG);
  expect(result.errors).toHaveLength(1);
});

test("context: 0 falls back to 5 and reports one error naming context", () => {
  const path = join(isolated.configHome, "context.json");
  writeFileSync(path, JSON.stringify({ context: 0 }), "utf-8");

  const result = loadConfig(path);

  expect(result.config.context).toBe(5);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]?.path).toBe("context");
});

test("theme.add: red falls back and reports one error naming theme.add", () => {
  const path = join(isolated.configHome, "theme.json");
  writeFileSync(path, JSON.stringify({ theme: { add: "red" } }), "utf-8");

  const result = loadConfig(path);

  expect(result.config.theme.add).toBe(DEFAULT_CONFIG.theme.add);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]?.path).toBe("theme.add");
});

test("editor as a non-empty string array validates", () => {
  const path = join(isolated.configHome, "editor.json");
  writeFileSync(path, JSON.stringify({ editor: ["kak", "-e", "x"] }), "utf-8");

  const result = loadConfig(path);

  expect(result.config.editor).toEqual(["kak", "-e", "x"]);
  expect(result.errors).toEqual([]);
});

test("saveConfig then loadConfig round-trips", () => {
  const path = join(isolated.configHome, "nested", "config.json");
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

test("a partial pane object only errors on the field that is actually invalid", () => {
  const path = join(isolated.configHome, "pane.json");
  writeFileSync(path, JSON.stringify({ pane: { width: "50%" } }), "utf-8");

  const result = loadConfig(path);

  expect(result.config.pane).toEqual({ width: "50%", height: DEFAULT_CONFIG.pane.height });
  expect(result.errors).toEqual([]);
});

test("saveConfig creates the parent directory", () => {
  const dir = join(isolated.configHome, "deep", "nested", "dir");
  const path = join(dir, "config.json");

  saveConfig(DEFAULT_CONFIG, path);

  expect(() => mkdirSync(dir, { recursive: true })).not.toThrow();
});

test("notes defaults to panel", () => {
  const result = loadConfig(join(isolated.configHome, "missing.json"));

  expect(result.config.notes).toBe("panel");
});

test("notes accepts anchored", () => {
  const path = join(isolated.configHome, "notes.json");
  writeFileSync(path, JSON.stringify({ notes: "anchored" }), "utf-8");

  const result = loadConfig(path);

  expect(result.config.notes).toBe("anchored");
  expect(result.errors).toEqual([]);
});

test("notes: inline is rejected with a ConfigError, since layout already owns that word", () => {
  const path = join(isolated.configHome, "notes-inline.json");
  writeFileSync(path, JSON.stringify({ notes: "inline" }), "utf-8");

  const result = loadConfig(path);

  expect(result.config.notes).toBe("panel");
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]?.path).toBe("notes");
});

test("syntax defaults to true", () => {
  const result = loadConfig(join(isolated.configHome, "missing.json"));

  expect(result.config.syntax).toBe(true);
});

test("syntax rejects a non-boolean", () => {
  const path = join(isolated.configHome, "syntax.json");
  writeFileSync(path, JSON.stringify({ syntax: "yes" }), "utf-8");

  const result = loadConfig(path);

  expect(result.config.syntax).toBe(true);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]?.path).toBe("syntax");
});

test("theme.rowBand defaults to true", () => {
  const result = loadConfig(join(isolated.configHome, "missing.json"));

  expect(result.config.theme.rowBand).toBe(true);
});

test("theme.rowBand rejects a non-boolean", () => {
  const path = join(isolated.configHome, "row-band.json");
  writeFileSync(path, JSON.stringify({ theme: { rowBand: "yes" } }), "utf-8");

  const result = loadConfig(path);

  expect(result.config.theme.rowBand).toBe(true);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]?.path).toBe("theme.rowBand");
});

test("editor: pair validates", () => {
  const path = join(isolated.configHome, "editor-pair.json");
  writeFileSync(path, JSON.stringify({ editor: "pair" }), "utf-8");

  const result = loadConfig(path);

  expect(result.config.editor).toBe("pair");
  expect(result.errors).toEqual([]);
});

test("a config file written before this task, with none of the three new fields, loads with every default and zero errors", () => {
  const path = join(isolated.configHome, "pre-task-10.json");
  const preExisting = {
    editor: "micro",
    multiplexer: "tmux",
    layout: "split",
    context: 5,
    minFold: 4,
    pane: { width: "90%", height: "90%" },
    theme: { add: "#1e3a1e", del: "#3a1e1e", fold: "#2a2a2a" },
    trace: false,
    autoApprove: true,
  };
  writeFileSync(path, JSON.stringify(preExisting), "utf-8");

  const result = loadConfig(path);

  expect(result.errors).toEqual([]);
  expect(result.config.notes).toBe(DEFAULT_CONFIG.notes);
  expect(result.config.syntax).toBe(DEFAULT_CONFIG.syntax);
  expect(result.config.theme.rowBand).toBe(DEFAULT_CONFIG.theme.rowBand);
});
