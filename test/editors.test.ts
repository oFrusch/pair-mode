import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, beforeEach } from "vitest";
import { vimEditor } from "../src/editors/vim";
import { createNanoEditor } from "../src/editors/nano";
import { resolve } from "../src/editors";
import type { EditorContext, PathResolver } from "../src/editors/editor.types";

let configDir: string;

const theme = { add: "#1e3a1e", del: "#3a1e1e", fold: "#2a2a2a" };

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "pair-mode-editors-"));
});

function context(overrides: Partial<EditorContext> = {}): EditorContext {
  return {
    leftFile: join(configDir, "left.go"),
    rightFile: join(configDir, "right.go"),
    resultFile: join(configDir, "result.json"),
    sourcePath: "main.go",
    theme,
    configDir,
    ...overrides,
  };
}

test("vim argv carries three hi commands with the theme colours", () => {
  const editor = vimEditor("vim");
  const launch = editor.prepare(context());

  expect(launch.argv).toContain(`hi PairAdd guibg=${theme.add}`);
  expect(launch.argv).toContain(`hi PairDel guibg=${theme.del}`);
  expect(launch.argv).toContain(`hi PairFold guibg=${theme.fold}`);
});

test("vim argv carries three matchadd calls applied to both windows", () => {
  const editor = vimEditor("vim");
  const launch = editor.prepare(context());

  const matchCommands = launch.argv.filter((entry) => entry.includes("matchadd"));

  expect(matchCommands).toHaveLength(3);

  for (const command of matchCommands) {
    expect(command.startsWith("windo call matchadd(")).toBe(true);
  }

  expect(matchCommands).toContain("windo call matchadd('PairAdd', '^▌▌+')");
  expect(matchCommands).toContain("windo call matchadd('PairDel', '^▌▌-')");
  expect(matchCommands).toContain("windo call matchadd('PairFold', '^⋯')");
});

test("vim sets filetype=go for a .go source and filetype=python for a .py source", () => {
  const editor = vimEditor("vim");

  const goLaunch = editor.prepare(context({ sourcePath: "main.go" }));
  const pyLaunch = editor.prepare(context({ sourcePath: "main.py" }));

  expect(goLaunch.argv).toContain("set filetype=go");
  expect(pyLaunch.argv).toContain("set filetype=python");
});

test("nvim and vim differ only in the binary name", () => {
  const vim = vimEditor("vim").prepare(context());
  const nvim = vimEditor("nvim").prepare(context());

  expect(vim.argv[0]).toBe("vim");
  expect(nvim.argv[0]).toBe("nvim");
  expect(vim.argv.slice(1)).toEqual(nvim.argv.slice(1));
});

test("bufferSuffix returns .go for vim and .diff for nano", () => {
  const vim = vimEditor("vim");
  const nano = createNanoEditor();

  expect(vim.bufferSuffix("main.go")).toBe(".go");
  expect(nano.bufferSuffix("main.go")).toBe(".diff");
});

test("the nano rcfile lands under configDir and holds three colour lines", () => {
  const nano = createNanoEditor();
  nano.prepare(context());

  const text = readFileSync(join(configDir, "pair.nanorc"), "utf-8");
  const colorLines = text.split("\n").filter((line) => line.startsWith("color "));

  expect(colorLines).toHaveLength(3);
  expect(text).toContain(theme.add);
  expect(text).toContain(theme.del);
  expect(text).toContain(theme.fold);
});

test("resolve of a custom command array returns a passthrough editor", () => {
  const editor = resolve(["kak", "-e", "x"]);
  const launch = editor.prepare(context());

  expect(launch.argv.slice(0, 3)).toEqual(["kak", "-e", "x"]);
  expect(launch.argv.slice(-2)).toEqual([context().leftFile, context().rightFile]);
  expect(editor.name).toBe("custom");
});

test("resolve(auto) prefers micro when every binary is available", () => {
  const alwaysAvailable: PathResolver = () => true;
  const editor = resolve("auto", alwaysAvailable);

  expect(editor.name).toBe("micro");
});

test("resolve(auto) falls back to vim when nothing is available", () => {
  const neverAvailable: PathResolver = () => false;
  const editor = resolve("auto", neverAvailable);

  expect(editor.name).toBe("vim");
});

test("vim and nvim tell the user to save and quit with :wqa", () => {
  expect(vimEditor("vim").headerHint()).toEqual(["# Save and quit both windows with :wqa."]);
  expect(vimEditor("nvim").headerHint()).toEqual(["# Save and quit both windows with :wqa."]);
});

test("nano tells the user to save with Ctrl+O and exit with Ctrl+X", () => {
  const nano = createNanoEditor();
  expect(nano.headerHint()).toEqual(["# Save with Ctrl+O, then exit with Ctrl+X."]);
});

test("a passthrough custom editor gives a generic save hint", () => {
  const editor = resolve(["kak", "-e", "x"]);
  expect(editor.headerHint()).toEqual(["# Save the right pane before you quit."]);
});

test("vim prepare throws on a theme colour carrying a vim command separator", () => {
  const editor = vimEditor("vim");
  const badTheme = { add: "#123456|only", del: "#3a1e1e", fold: "#2a2a2a" };

  expect(() => editor.prepare(context({ theme: badTheme }))).toThrow(/invalid theme colour/);
});

test("nano prepare throws on a theme colour carrying a space that would shift nanorc tokens", () => {
  const nano = createNanoEditor();
  const badTheme = { add: "#123 456", del: "#3a1e1e", fold: "#2a2a2a" };

  expect(() => nano.prepare(context({ theme: badTheme }))).toThrow(/invalid theme colour/);
});
