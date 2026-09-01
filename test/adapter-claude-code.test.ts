import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, beforeAll, afterAll } from "vitest";
import { useIsolatedHome } from "./helpers/env";
import { enable, enableSession, sessionKey } from "../src/core/state";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const isolated = useIsolatedHome();

let outDir: string;
let bundlePath: string;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "pair-mode-bundle-"));
  bundlePath = join(outDir, "claude-code.js");

  await build({
    entryPoints: [join(repoRoot, "src/adapters/claude-code/claude-code.ts")],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    banner: {
      js: 'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);',
    },
  });
});

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
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
  const stateHome = isolated.tempDir("pair-mode-state-");
  const targetDir = isolated.tempDir("pair-mode-target-");
  const filePath = join(targetDir, "example.ts");

  const fakeBinDir = isolated.tempDir("pair-mode-bin-");
  const tmuxPath = join(fakeBinDir, "tmux");
  writeFileSync(tmuxPath, FAKE_TMUX, "utf-8");
  chmodSync(tmuxPath, 0o755);

  process.env["XDG_STATE_HOME"] = stateHome;
  enable(targetDir);
  process.env["XDG_STATE_HOME"] = isolated.stateHome;

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
  configOverrides: Record<string, unknown> = {},
): { status: number | null; stdout: string; stderr: string } {
  const configHome = isolated.tempDir("pair-mode-config-");
  const fakeHome = isolated.tempDir("pair-mode-home-");

  const overrides = layout === "inline" ? { layout, ...configOverrides } : configOverrides;

  if (Object.keys(overrides).length > 0) {
    const configDir = join(configHome, "pair-mode");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), JSON.stringify(overrides), "utf-8");
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

const ALLOW_JSON = JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    permissionDecisionReason: "reviewed in pair mode",
  },
});

test("a clean quit with no questions and autoApprove true writes the allow JSON and exits 0", () => {
  const harness = setupHarness();
  const editorScript = writeEditorScript(harness.targetDir, null);

  const payload = JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: harness.filePath, content: "hello\nworld\n" },
  });

  const outcome = runAdapter(payload, harness, editorScript, "split", { autoApprove: true });

  expect(outcome.status).toBe(0);
  expect(outcome.stdout).toBe(ALLOW_JSON + "\n");
});

test("a clean quit with no questions and autoApprove false writes nothing and exits 0", () => {
  const harness = setupHarness();
  const editorScript = writeEditorScript(harness.targetDir, null);

  const payload = JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: harness.filePath, content: "hello\nworld\n" },
  });

  const outcome = runAdapter(payload, harness, editorScript, "split", { autoApprove: false });

  expect(outcome.status).toBe(0);
  expect(outcome.stdout).toBe("");
});

test("a payload with no file_path exits 0 and writes nothing", () => {
  const harness = setupHarness();

  const payload = JSON.stringify({ tool_name: "Write", tool_input: { content: "hello" } });

  const outcome = runAdapter(payload, harness, null);

  expect(outcome.status).toBe(0);
  expect(outcome.stdout).toBe("");
});

test("a path with no flag file exits 0 and writes nothing", () => {
  const stateHome = isolated.tempDir("pair-mode-state-");
  const targetDir = isolated.tempDir("pair-mode-target-");
  const filePath = join(targetDir, "example.ts");
  const fakeBinDir = isolated.tempDir("pair-mode-bin-");

  const harness: Harness = { stateHome, targetDir, filePath, fakeBinDir };

  const payload = JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: filePath, content: "hello\nworld\n" },
  });

  const outcome = runAdapter(payload, harness, null);

  expect(outcome.status).toBe(0);
  expect(outcome.stdout).toBe("");
});

test("malformed JSON on stdin exits 0 and writes nothing", () => {
  const harness = setupHarness();

  const outcome = runAdapter("{not json", harness, null);

  expect(outcome.status).toBe(0);
  expect(outcome.stdout).toBe("");
});

test("a multiplexer failure exits 0 and writes nothing", () => {
  const harness = setupHarness();

  const brokenBinDir = isolated.tempDir("pair-mode-bin-broken-");
  const brokenTmux = join(brokenBinDir, "tmux");
  writeFileSync(brokenTmux, "#!/bin/sh\nexit 1\n", "utf-8");
  chmodSync(brokenTmux, 0o755);

  const brokenHarness: Harness = { ...harness, fakeBinDir: brokenBinDir };
  const editorScript = writeEditorScript(harness.targetDir, null);

  const payload = JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: harness.filePath, content: "hello\nworld\n" },
  });

  const outcome = runAdapter(payload, brokenHarness, editorScript);

  expect(outcome.status).toBe(0);
  expect(outcome.stdout).toBe("");
});

test("an annotated review exits 2 with the questions on stderr and writes no allow JSON", () => {
  const harness = setupHarness();
  const editorScript = writeEditorScript(harness.targetDir, "why does this work?");

  const payload = JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: harness.filePath, content: "hello\nworld\n" },
  });

  const outcome = runAdapter(payload, harness, editorScript);

  expect(outcome.status).toBe(2);
  expect(outcome.stderr).toContain("why does this work?");
  expect(outcome.stdout).toBe("");
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

const PARENT_SESSION_ID = "d95655de-eb7f-45e5-867d-9797a355353e";

// No directory flag here, so only the session flag derived from session_id can turn pair mode on.
function setupSessionOnlyHarness(sessionId: string): Harness {
  const stateHome = isolated.tempDir("pair-mode-state-");
  const targetDir = isolated.tempDir("pair-mode-target-");
  const filePath = join(targetDir, "example.ts");

  const fakeBinDir = isolated.tempDir("pair-mode-bin-");
  const tmuxPath = join(fakeBinDir, "tmux");
  writeFileSync(tmuxPath, FAKE_TMUX, "utf-8");
  chmodSync(tmuxPath, 0o755);

  process.env["XDG_STATE_HOME"] = stateHome;
  enableSession(sessionKey(sessionId));
  process.env["XDG_STATE_HOME"] = isolated.stateHome;

  return { stateHome, targetDir, filePath, fakeBinDir };
}

test("a payload session id enables the hook through the session flag alone", () => {
  const harness = setupSessionOnlyHarness(PARENT_SESSION_ID);
  const editorScript = writeEditorScript(harness.targetDir, "why does this work?");

  const payload = JSON.stringify({
    session_id: PARENT_SESSION_ID,
    tool_name: "Write",
    tool_input: { file_path: harness.filePath, content: "hello\nworld\n" },
  });

  const outcome = runAdapter(payload, harness, editorScript);

  expect(outcome.status).toBe(2);
  expect(outcome.stderr).toContain("why does this work?");
});

// A subagent sends the parent's session_id plus agent_id and agent_type, and those extras must not shift the key.
test("a subagent payload resolves the same session key as its parent", () => {
  const harness = setupSessionOnlyHarness(PARENT_SESSION_ID);
  const editorScript = writeEditorScript(harness.targetDir, "why does this work?");

  const payload = JSON.stringify({
    session_id: PARENT_SESSION_ID,
    agent_id: "agent-7",
    agent_type: "general-purpose",
    tool_name: "Write",
    tool_input: { file_path: harness.filePath, content: "hello\nworld\n" },
  });

  const outcome = runAdapter(payload, harness, editorScript);

  expect(outcome.status).toBe(2);
  expect(outcome.stderr).toContain("why does this work?");
});

test("a payload with an unrelated session id leaves the hook off", () => {
  const harness = setupSessionOnlyHarness(PARENT_SESSION_ID);
  const editorScript = writeEditorScript(harness.targetDir, "why does this work?");

  const payload = JSON.stringify({
    session_id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
    tool_name: "Write",
    tool_input: { file_path: harness.filePath, content: "hello\nworld\n" },
  });

  const outcome = runAdapter(payload, harness, editorScript);

  expect(outcome.status).toBe(0);
  expect(outcome.stdout).toBe("");
});
