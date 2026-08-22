import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
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
    entryPoints: [join(repoRoot, "src/adapters/claude-code.ts")],
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
  const body = appendLine === null ? "#!/bin/sh\nexit 0\n" : `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(appendLine)} >> "$2"\n`;

  writeFileSync(scriptPath, body, "utf-8");
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function runAdapter(payload: string, harness: Harness, editorScript: string | null): { status: number | null; stdout: string; stderr: string } {
  const configHome = mkdtempSync(join(tmpdir(), "pair-mode-config-"));
  const fakeHome = mkdtempSync(join(tmpdir(), "pair-mode-home-"));

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
