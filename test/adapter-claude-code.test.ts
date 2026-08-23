import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, beforeAll } from "vitest";
import { enable } from "../src/core/state";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

let bundlePath: string;

beforeAll(async () => {
  const outDir = mkdtempSync(join(tmpdir(), "pair-mode-bundle-"));
  bundlePath = join(outDir, "claude-code.js");

  await build({
    entryPoints: [join(repoRoot, "src/adapters/claude-code/claude-code.ts")],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
  });
});

// A fake tmux resolved ahead of the real one on PATH, so the harness never needs a real terminal or a real tmux server.
const FAKE_TMUX = `#!/bin/sh
if [ "$1" = "display-popup" ]; then
  shift
  last=""
  for arg in "$@"; do
    last="$arg"
  done
  eval "$last"
  exit $?
fi

if [ "$1" = "wait-for" ]; then
  exit 0
fi

exit 1
`;

interface Harness {
  stateHome: string;
  targetDir: string;
  filePath: string;
  fakeBinDir: string;
}

function setupHarness(): Harness {
  const stateHome = mkdtempSync(join(tmpdir(), "pair-mode-state-"));
  const targetDir = mkdtempSync(join(tmpdir(), "pair-mode-target-"));
  const filePath = join(targetDir, "example.ts");

  const fakeBinDir = mkdtempSync(join(tmpdir(), "pair-mode-bin-"));
  const tmuxPath = join(fakeBinDir, "tmux");
  writeFileSync(tmuxPath, FAKE_TMUX, "utf-8");
  chmodSync(tmuxPath, 0o755);

  const previousXdgStateHome = process.env["XDG_STATE_HOME"];
  process.env["XDG_STATE_HOME"] = stateHome;
  enable(targetDir);

  if (previousXdgStateHome === undefined) {
    delete process.env["XDG_STATE_HOME"];
  } else {
    process.env["XDG_STATE_HOME"] = previousXdgStateHome;
  }

  return { stateHome, targetDir, filePath, fakeBinDir };
}

function writeEditorScript(dir: string, appendLine: string | null): string {
  const scriptPath = join(dir, "editor.sh");
  const body =
    appendLine === null
      ? "#!/bin/sh\nexit 0\n"
      : `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(appendLine)} >> "$2"\n`;

  writeFileSync(scriptPath, body, "utf-8");
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function writeEditorScriptForArg(dir: string, argIndex: 1 | 2, appendLine: string): string {
  const scriptPath = join(dir, `editor-arg${argIndex}.sh`);
  const body = `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(appendLine)} >> "$${argIndex}"\n`;

  writeFileSync(scriptPath, body, "utf-8");
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function runAdapter(
  payload: string,
  harness: Harness,
  editorScript: string | null,
  layout: "split" | "inline" = "split",
): { status: number | null; stdout: string; stderr: string } {
  const configHome = mkdtempSync(join(tmpdir(), "pair-mode-config-"));
  const fakeHome = mkdtempSync(join(tmpdir(), "pair-mode-home-"));

  if (layout === "inline") {
    const configDir = join(configHome, "pair-mode");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), JSON.stringify({ layout: "inline" }), "utf-8");
  }

  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${harness.fakeBinDir}:${process.env["PATH"] ?? ""}`,
    XDG_STATE_HOME: harness.stateHome,
    XDG_CONFIG_HOME: configHome,
    HOME: fakeHome,
    TMUX: "1",
  };

  delete env["ZELLIJ"];
  delete env["VISUAL"];
  delete env["EDITOR"];

  if (editorScript !== null) {
    env["CC_PAIR_EDITOR"] = editorScript;
  } else {
    delete env["CC_PAIR_EDITOR"];
  }

  const result = spawnSync("node", [bundlePath], { input: payload, env, encoding: "utf-8" });

  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("a payload with a question line exits 2 and reports the question and the file path", () => {
  const harness = setupHarness();
  const editorScript = writeEditorScript(harness.targetDir, "why does this work?");

  const payload = JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: harness.filePath, content: "hello\nworld\n" },
  });

  const outcome = runAdapter(payload, harness, editorScript);

  expect(outcome.status).toBe(2);
  expect(outcome.stderr).toContain("why does this work?");
  expect(outcome.stderr).toContain(harness.filePath);
});

test("an editor that changes nothing exits 0", () => {
  const harness = setupHarness();
  const editorScript = writeEditorScript(harness.targetDir, null);

  const payload = JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: harness.filePath, content: "hello\nworld\n" },
  });

  const outcome = runAdapter(payload, harness, editorScript);

  expect(outcome.status).toBe(0);
});

test("a payload with no file_path exits 0", () => {
  const harness = setupHarness();

  const payload = JSON.stringify({ tool_name: "Write", tool_input: { content: "hello" } });

  const outcome = runAdapter(payload, harness, null);

  expect(outcome.status).toBe(0);
});

test("a path with no flag file exits 0", () => {
  const stateHome = mkdtempSync(join(tmpdir(), "pair-mode-state-"));
  const targetDir = mkdtempSync(join(tmpdir(), "pair-mode-target-"));
  const filePath = join(targetDir, "example.ts");
  const fakeBinDir = mkdtempSync(join(tmpdir(), "pair-mode-bin-"));

  const harness: Harness = { stateHome, targetDir, filePath, fakeBinDir };

  const payload = JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: filePath, content: "hello\nworld\n" },
  });

  const outcome = runAdapter(payload, harness, null);

  expect(outcome.status).toBe(0);
});

test("malformed JSON on stdin exits 0", () => {
  const harness = setupHarness();

  const outcome = runAdapter("{not json", harness, null);

  expect(outcome.status).toBe(0);
});

test("importing the module as a library does not read stdin or call process.exit", async () => {
  // Before the entry-point guard, importing this file read fd 0 (blocking here) and called process.exit, killing the test runner.
  await expect(import("../src/adapters/claude-code/claude-code")).resolves.toBeDefined();
});

test("the rendered header carries the resolved editor's own key hint, not micro's hardcoded one", () => {
  const harness = setupHarness();
  const scriptPath = join(harness.targetDir, "check-header.sh");
  const script = [
    "#!/bin/sh",
    'if grep -qF "# Save the right pane before you quit." "$2" && ! grep -qF "F3 moves between panes" "$2"; then',
    "  printf 'header ok\\n' >> \"$2\"",
    "fi",
    "",
  ].join("\n");
  writeFileSync(scriptPath, script, "utf-8");
  chmodSync(scriptPath, 0o755);

  const payload = JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: harness.filePath, content: "hello\nworld\n" },
  });

  const outcome = runAdapter(payload, harness, scriptPath);

  expect(outcome.status).toBe(2);
  expect(outcome.stderr).toContain("header ok");
});

test("inline layout: a question written into the first buffer argument is not lost", () => {
  const harness = setupHarness();
  const editorScript = writeEditorScriptForArg(harness.targetDir, 1, "why does this work?");

  const payload = JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: harness.filePath, content: "hello\nworld\n" },
  });

  const outcome = runAdapter(payload, harness, editorScript, "inline");

  expect(outcome.status).toBe(2);
  expect(outcome.stderr).toContain("why does this work?");
});

test("split layout: annotating the first (left, reference) buffer argument produces no question", () => {
  const harness = setupHarness();
  const editorScript = writeEditorScriptForArg(harness.targetDir, 1, "why does this work?");

  const payload = JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: harness.filePath, content: "hello\nworld\n" },
  });

  const outcome = runAdapter(payload, harness, editorScript, "split");

  expect(outcome.status).toBe(0);
});
