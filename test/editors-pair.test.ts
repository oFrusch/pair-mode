import { test, expect } from "vitest";
import { createPairEditor } from "../src/editors/pair";
import { resolve, describe } from "../src/editors";
import { DEFAULT_CONFIG } from "../src/core/config";
import type { EditorContext, PathResolver } from "../src/editors/editor.types";
import type { BundleExistsChecker } from "../src/editors/pair.types";

const FAKE_ENTRY = "/fake/dist/pair-tui.js";
const fakeResolveTuiEntry = () => FAKE_ENTRY;

function context(overrides: Partial<EditorContext> = {}): EditorContext {
  return {
    leftFile: "/tmp/pair-current.go",
    rightFile: "/tmp/pair-proposed.go",
    resultFile: "/tmp/pair-result.json",
    sourcePath: "main.go",
    theme: { add: "#1e3a1e", del: "#3a1e1e", fold: "#2a2a2a", rowBand: false },
    configDir: "/tmp/pair-editor-config",
    config: DEFAULT_CONFIG,
    ...overrides,
  };
}

test("available is true when the bundle exists", () => {
  const existsChecker: BundleExistsChecker = () => true;

  expect(createPairEditor(fakeResolveTuiEntry, existsChecker).available()).toBe(true);
});

test("available is false when the bundle is missing", () => {
  const existsChecker: BundleExistsChecker = () => false;

  expect(createPairEditor(fakeResolveTuiEntry, existsChecker).available()).toBe(false);
});

test("available checks existence of the path the resolver returns", () => {
  const seen: string[] = [];
  const existsChecker: BundleExistsChecker = (entryPath) => {
    seen.push(entryPath);
    return true;
  };

  createPairEditor(fakeResolveTuiEntry, existsChecker).available();

  expect(seen).toEqual([FAKE_ENTRY]);
});

test("auto falls through to micro when the pair bundle is missing", () => {
  const editor = resolve("auto", () => true, () => false);

  expect(editor.name).toBe("micro");
});

test("auto returns pair when the pair bundle is present", () => {
  const editor = resolve("auto", () => true, () => true);

  expect(editor.name).toBe("pair");
});

test("explicit pair still resolves even when the bundle is missing", () => {
  const editor = resolve("pair", () => true, () => false);

  expect(editor.name).toBe("pair");
});

test("collectMode is result-file", () => {
  expect(createPairEditor().collectMode).toBe("result-file");
});

test("headerHint is empty", () => {
  expect(createPairEditor().headerHint()).toEqual([]);
});

test("resolve(auto) returns the pair editor when the bundle is present", () => {
  const editor = resolve("auto", () => false, () => true);

  expect(editor.name).toBe("pair");
});

test("resolve(pair) returns the pair editor", () => {
  const editor = resolve("pair");

  expect(editor.name).toBe("pair");
});

test("resolve(micro) still returns micro", () => {
  const editor = resolve("micro");

  expect(editor.name).toBe("micro");
});

test("resolve(vim), resolve(nvim), and resolve(nano) do not regress", () => {
  expect(resolve("vim").name).toBe("vim");
  expect(resolve("nvim").name).toBe("nvim");
  expect(resolve("nano").name).toBe("nano");
});

test("describe lists pair", () => {
  const lines = describe();

  expect(lines.some((line) => line.startsWith("pair:"))).toBe(true);
});

test("prepare emits every argv flag", () => {
  const editor = createPairEditor(fakeResolveTuiEntry);
  const launch = editor.prepare(context());

  expect(launch.argv).toEqual([
    FAKE_ENTRY,
    "--left",
    "/tmp/pair-current.go",
    "--right",
    "/tmp/pair-proposed.go",
    "--path",
    "main.go",
    "--result",
    "/tmp/pair-result.json",
    "--layout",
    "split",
    "--notes",
    "panel",
    "--row-band",
    "true",
    "--syntax",
    "true",
    "--context",
    String(DEFAULT_CONFIG.context),
    "--min-fold",
    String(DEFAULT_CONFIG.minFold),
  ]);
  expect(launch.env).toEqual({});
});

test("prepare emits --context and --min-fold from config", () => {
  const editor = createPairEditor(fakeResolveTuiEntry);
  const launch = editor.prepare(context({ config: { ...DEFAULT_CONFIG, context: 20, minFold: 7 } }));

  const contextIndex = launch.argv.indexOf("--context");
  const minFoldIndex = launch.argv.indexOf("--min-fold");

  expect(launch.argv[contextIndex + 1]).toBe("20");
  expect(launch.argv[minFoldIndex + 1]).toBe("7");
});

test("prepare turns layout: inline into --layout unified", () => {
  const editor = createPairEditor(fakeResolveTuiEntry);
  const launch = editor.prepare(context({ config: { ...DEFAULT_CONFIG, layout: "inline" } }));

  const layoutIndex = launch.argv.indexOf("--layout");

  expect(launch.argv[layoutIndex + 1]).toBe("unified");
});

test("prepare with layout: split emits --layout split", () => {
  const editor = createPairEditor(fakeResolveTuiEntry);
  const launch = editor.prepare(context({ config: { ...DEFAULT_CONFIG, layout: "split" } }));

  const layoutIndex = launch.argv.indexOf("--layout");

  expect(launch.argv[layoutIndex + 1]).toBe("split");
});

test("prepare emits --notes anchored when config says so", () => {
  const editor = createPairEditor(fakeResolveTuiEntry);
  const launch = editor.prepare(context({ config: { ...DEFAULT_CONFIG, notes: "anchored" } }));

  const notesIndex = launch.argv.indexOf("--notes");

  expect(launch.argv[notesIndex + 1]).toBe("anchored");
});

test("prepare uses the injected path resolver and never touches the filesystem", () => {
  let calls = 0;
  const resolver = () => {
    calls += 1;
    return FAKE_ENTRY;
  };

  const editor = createPairEditor(resolver);
  const launch = editor.prepare(
    context({
      leftFile: "/nonexistent/left.go",
      rightFile: "/nonexistent/right.go",
      resultFile: "/nonexistent/result.json",
      configDir: "/nonexistent/config-dir",
    }),
  );

  expect(calls).toBe(1);
  expect(launch.argv[0]).toBe(FAKE_ENTRY);
});

test("resolve of an unused path resolver is never invoked when pair is chosen", () => {
  const failingResolver: PathResolver = () => {
    throw new Error("should not be called");
  };

  expect(() => resolve("pair", failingResolver)).not.toThrow();
});
