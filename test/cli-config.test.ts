import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, beforeEach } from "vitest";
import { runConfig, SETTINGS } from "../src/cli/config";
import { loadConfig, DEFAULT_CONFIG } from "../src/core/config";
import { useIsolatedHome } from "./helpers/env";

const isolated = useIsolatedHome();

let path: string;

beforeEach(() => {
  path = join(isolated.tempDir("pair-mode-config-"), "config.json");
});

test("a bare config call lists every setting with its current value", () => {
  const result = runConfig([], path);

  expect(result.exitCode).toBe(0);
  SETTINGS.forEach((setting) => expect(result.text).toContain(setting.key));
});

test("a key with no value prints only that value", () => {
  expect(runConfig(["transport"], path)).toEqual({ text: "pane", exitCode: 0 });
});

test("setting a key writes the file and echoes the new value", () => {
  const result = runConfig(["transport", "session"], path);

  expect(result).toEqual({ text: "transport = session", exitCode: 0 });
  expect(loadConfig(path).config.transport).toBe("session");
});

test("a written config parses back with no validation errors", () => {
  runConfig(["transport", "session"], path);
  runConfig(["session.timeout", "42"], path);

  const loaded = loadConfig(path);

  expect(loaded.errors).toEqual([]);
  expect(loaded.config.session.timeout).toBe(42);
});

test("a nested key changes only its own field", () => {
  runConfig(["web.port", "8080"], path);

  const config = loadConfig(path).config;

  expect(config.web.port).toBe(8080);
  expect(config.web.enabled).toBe(DEFAULT_CONFIG.web.enabled);
});

test("an unknown key fails and names every known key", () => {
  const result = runConfig(["nope", "1"], path);

  expect(result.exitCode).toBe(1);
  expect(result.text).toContain('unknown key "nope"');
  expect(result.text).toContain("session.timeout");
});

test("a value outside a setting's range fails and never writes the file", () => {
  const result = runConfig(["web.port", "70000"], path);

  expect(result.exitCode).toBe(1);
  expect(result.text).toContain("an integer from 0 to 65535");
  expect(loadConfig(path).config.web.port).toBe(DEFAULT_CONFIG.web.port);
});

test("a value outside a boolean setting fails", () => {
  const result = runConfig(["syntax", "yes"], path);

  expect(result.exitCode).toBe(1);
  expect(result.text).toContain("true or false");
});

test("a colour that is not hex fails", () => {
  const result = runConfig(["theme.add", "green"], path);

  expect(result.exitCode).toBe(1);
  expect(result.text).toContain("hex colour");
});

test("an editor name outside the known list fails, but a multi-word command lands as an array", () => {
  expect(runConfig(["editor", "emacs"], path).exitCode).toBe(1);

  runConfig(["editor", "code", "--wait"], path);

  expect(loadConfig(path).config.editor).toEqual(["code", "--wait"]);
});

test("the written file is valid JSON ending in a newline", () => {
  runConfig(["transport", "session"], path);

  const raw = readFileSync(path, "utf-8");

  expect(raw.endsWith("\n")).toBe(true);
  expect(() => JSON.parse(raw)).not.toThrow();
});

test("every setting reads back the value it just wrote", () => {
  const cases = [
    ["multiplexer", "tmux"],
    ["layout", "inline"],
    ["notes", "anchored"],
    ["context", "9"],
    ["minFold", "2"],
    ["pane.width", "80%"],
    ["session.timeout", "60"],
    ["web.enabled", "true"],
    ["theme.rowBand", "false"],
    ["trace", "true"],
  ];

  cases.forEach(([key, value]) => {
    expect(runConfig([key ?? "", value ?? ""], path).exitCode).toBe(0);
    expect(runConfig([key ?? ""], path).text).toBe(value);
  });
});
