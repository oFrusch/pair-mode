import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, beforeEach } from "vitest";
import { createMicroEditor } from "../src/editors/micro";
import type { EditorContext } from "../src/editors/editor.types";

let configDir: string;

const theme = { add: "#1e3a1e", del: "#3a1e1e", fold: "#2a2a2a" };

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "pair-mode-micro-"));
});

function context(overrides: Partial<EditorContext> = {}): EditorContext {
  return {
    leftFile: join(configDir, "left.txt"),
    rightFile: join(configDir, "right.txt"),
    sourcePath: "main.go",
    theme,
    configDir,
    ...overrides,
  };
}

test("prepare writes all four config paths", () => {
  const editor = createMicroEditor();
  editor.prepare(context());

  const bindings = JSON.parse(readFileSync(join(configDir, "bindings.json"), "utf-8"));
  const settings = JSON.parse(readFileSync(join(configDir, "settings.json"), "utf-8"));

  expect(bindings).toEqual({
    F2: "QuitAll",
    CtrlW: "QuitAll",
    "Alt-s": "QuitAll",
    F3: "NextSplit",
    F4: "PreviousSplit",
  });

  expect(settings).toEqual({
    softwrap: true,
    ruler: true,
    savehistory: false,
    autosave: 1,
    colorscheme: "pair",
  });

  expect(() => readFileSync(join(configDir, "colorschemes", "pair.micro"), "utf-8")).not.toThrow();
  expect(() => readFileSync(join(configDir, "syntax", "pair-go.yaml"), "utf-8")).not.toThrow();
});

test("pair.micro carries the theme background values", () => {
  const editor = createMicroEditor();
  editor.prepare(context());

  const text = readFileSync(join(configDir, "colorschemes", "pair.micro"), "utf-8");

  expect(text).toContain('include "monokai"');
  expect(text).toContain(`color-link pairadd "#d7ffd7,${theme.add}"`);
  expect(text).toContain(`color-link pairdel "#ffd7d7,${theme.del}"`);
  expect(text).toContain(`color-link pairskip "#6a6a6a,${theme.fold}"`);
});

test("the generated syntax YAML ends with the band regions", () => {
  const editor = createMicroEditor();
  editor.prepare(context());

  const text = readFileSync(join(configDir, "syntax", "pair-go.yaml"), "utf-8");

  expect(text.trimEnd().endsWith('- comment:\n        start: "^#"\n        end: "$"')).toBe(true);
  expect(text).toContain('start: "^▌▌\\\\+"');
});

test("the generated syntax YAML has no single backslash before . or + in a quoted string", () => {
  const editor = createMicroEditor();
  editor.prepare(context());

  const text = readFileSync(join(configDir, "syntax", "pair-go.yaml"), "utf-8");
  const withoutDoubledBackslashes = text.replaceAll("\\\\", "");

  expect(withoutDoubledBackslashes).not.toMatch(/\\[.+]/);
});

test("bufferSuffix returns .pair-go for a .go path and .diff for a .xyz path", () => {
  const editor = createMicroEditor();

  expect(editor.bufferSuffix("main.go")).toBe(".pair-go");
  expect(editor.bufferSuffix("notes.xyz")).toBe(".diff");
});

test("argv contains -multiopen and vsplit in order, and both buffer paths", () => {
  const editor = createMicroEditor();
  const launch = editor.prepare(context());

  const multiopenIndex = launch.argv.indexOf("-multiopen");
  const vsplitIndex = launch.argv.indexOf("vsplit");

  expect(multiopenIndex).toBeGreaterThanOrEqual(0);
  expect(vsplitIndex).toBe(multiopenIndex + 1);
  expect(launch.argv).toContain(context().leftFile);
  expect(launch.argv).toContain(context().rightFile);
});

test("headerHint keeps micro's own key instructions", () => {
  const editor = createMicroEditor();
  expect(editor.headerHint()).toEqual(["# F3 moves between panes. Ctrl+W or F2 sends and closes."]);
});

test("env.MICRO_CONFIG_HOME equals the config directory", () => {
  const editor = createMicroEditor();
  const launch = editor.prepare(context());

  expect(launch.env["MICRO_CONFIG_HOME"]).toBe(configDir);
});
