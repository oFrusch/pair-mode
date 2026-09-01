import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, beforeAll, afterAll } from "vitest";
import { useIsolatedHome } from "./helpers/env";
import { enable, enableSession, sessionKey } from "../src/core/state";
import { parsePatch, extractPatchText } from "../src/adapters/codex";
import { applyEdit } from "../src/core/simulate";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const isolated = useIsolatedHome();

let outDir: string;
let bundlePath: string;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "pair-mode-bundle-"));
  bundlePath = join(outDir, "codex.js");

  await build({
    entryPoints: [join(repoRoot, "src/adapters/codex/codex.ts")],
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

function runAdapter(
  payload: string,
  harness: Harness,
  editorScript: string | null,
): { status: number | null; stdout: string; stderr: string } {
  const configHome = isolated.tempDir("pair-mode-config-");
  const fakeHome = isolated.tempDir("pair-mode-home-");

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

test("a Write payload with the flag on and an editor that adds a question denies", () => {
  const harness = setupHarness();
  const editorScript = writeEditorScript(harness.targetDir, "why does this work?");

  const payload = JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: harness.filePath, content: "hello\nworld\n" },
  });

  const outcome = runAdapter(payload, harness, editorScript);

  expect(outcome.status).toBe(0);
  const parsed = JSON.parse(outcome.stdout);
  expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("why does this work?");
});

test("an apply_patch Update File payload parses into the right before and after text", () => {
  const harness = setupHarness();
  writeFileSync(harness.filePath, "line one\nline two\nline three\n", "utf-8");

  const editorScript = writeEditorScript(harness.targetDir, "why?");

  const patch = [
    "*** Begin Patch",
    `*** Update File: ${harness.filePath}`,
    "@@",
    " line one",
    "-line two",
    "+line TWO",
    " line three",
    "*** End Patch",
    "",
  ].join("\n");

  const payload = JSON.stringify({
    tool_name: "apply_patch",
    tool_input: { command: patch },
  });

  const outcome = runAdapter(payload, harness, editorScript);

  expect(outcome.status).toBe(0);
  const parsed = JSON.parse(outcome.stdout);
  expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("why?");
});

// Codex validates the whole object against its schema and drops a deny that omits hookEventName.
test("a deny carries the exact hookSpecificOutput shape the Codex schema requires", () => {
  const harness = setupHarness();
  const editorScript = writeEditorScript(harness.targetDir, "why?");

  const payload = JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: harness.filePath, content: "hello\n" },
  });

  const outcome = runAdapter(payload, harness, editorScript);
  const parsed = JSON.parse(outcome.stdout);

  expect(Object.keys(parsed)).toEqual(["hookSpecificOutput"]);
  expect(Object.keys(parsed.hookSpecificOutput).sort()).toEqual([
    "hookEventName",
    "permissionDecision",
    "permissionDecisionReason",
  ]);
  expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
});

test("an unparseable apply_patch patch exits 0 with no output", () => {
  const harness = setupHarness();
  writeFileSync(harness.filePath, "line one\n", "utf-8");

  const patch = [
    "*** Begin Patch",
    `*** Update File: ${harness.filePath}`,
    "*** Move to: /tmp/elsewhere.ts",
    "@@",
    " line one",
    "*** End Patch",
    "",
  ].join("\n");

  const payload = JSON.stringify({
    tool_name: "apply_patch",
    tool_input: { command: patch },
  });

  const outcome = runAdapter(payload, harness, null);

  expect(outcome.status).toBe(0);
  expect(outcome.stdout).toBe("");
});

test("a payload for a path with no flag file exits 0", () => {
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

test("malformed JSON on stdin exits 0", () => {
  const harness = setupHarness();

  const outcome = runAdapter("{not json", harness, null);

  expect(outcome.status).toBe(0);
});

test("parsePatch reconstructs the exact before and after text for an Update File patch", () => {
  const patch = [
    "*** Begin Patch",
    "*** Update File: /tmp/example.ts",
    "@@",
    " line one",
    "-line two",
    "+line TWO",
    " line three",
    "*** End Patch",
    "",
  ].join("\n");

  const parsed = parsePatch(patch);

  expect(parsed).not.toBeNull();
  expect(parsed?.filePath).toBe("/tmp/example.ts");
  expect(parsed?.tool).toBe("MultiEdit");
  expect(parsed?.edits).toEqual([
    { old_string: "line one\nline two\nline three", new_string: "line one\nline TWO\nline three" },
  ]);

  const before = "line one\nline two\nline three";
  const edit = parsed?.edits?.[0];
  const after = edit === undefined ? null : applyEdit(before, edit);

  expect(after).toBe("line one\nline TWO\nline three");
});

test("parsePatch extracts a single-file Update patch terminated by the End of File sentinel", () => {
  const patch = [
    "*** Begin Patch",
    "*** Update File: /tmp/example.ts",
    "@@",
    " line one",
    "-line two",
    "+line TWO",
    "*** End of File",
    "*** End Patch",
    "",
  ].join("\n");

  const parsed = parsePatch(patch);

  expect(parsed).not.toBeNull();
  expect(parsed?.filePath).toBe("/tmp/example.ts");
  expect(parsed?.tool).toBe("MultiEdit");
  expect(parsed?.edits).toEqual([
    { old_string: "line one\nline two", new_string: "line one\nline TWO" },
  ]);
});

test("parsePatch still declines a multi-file patch whose first section ends at End of File", () => {
  const patch = [
    "*** Begin Patch",
    "*** Update File: /tmp/first.ts",
    "@@",
    " line one",
    "+line two",
    "*** End of File",
    "*** Update File: /tmp/second.ts",
    "@@",
    " line three",
    "+line four",
    "*** End Patch",
    "",
  ].join("\n");

  expect(parsePatch(patch)).toBeNull();
});

test("parsePatch reconstructs the exact content for an Add File patch", () => {
  const patch = [
    "*** Begin Patch",
    "*** Add File: /tmp/hello.txt",
    "+Hello, world!",
    "*** End Patch",
    "",
  ].join("\n");

  const parsed = parsePatch(patch);

  expect(parsed).not.toBeNull();
  expect(parsed?.filePath).toBe("/tmp/hello.txt");
  expect(parsed?.tool).toBe("Write");
  expect(parsed?.content).toBe("Hello, world!\n");
});

test("parsePatch keeps a trimmed blank context line in an Update File hunk, not drops it", () => {
  const patch = [
    "*** Begin Patch",
    "*** Update File: /tmp/example.ts",
    "@@",
    " line one",
    "",
    " line three",
    "*** End Patch",
    "",
  ].join("\n");

  const parsed = parsePatch(patch);

  expect(parsed).not.toBeNull();
  expect(parsed?.edits).toEqual([
    { old_string: "line one\n\nline three", new_string: "line one\n\nline three" },
  ]);
});

test("parsePatch keeps a trimmed blank added line in an Add File patch, not drops it", () => {
  const patch = [
    "*** Begin Patch",
    "*** Add File: /tmp/hello.txt",
    "+Hello, world!",
    "",
    "+Goodbye.",
    "*** End Patch",
    "",
  ].join("\n");

  const parsed = parsePatch(patch);

  expect(parsed).not.toBeNull();
  expect(parsed?.content).toBe("Hello, world!\n\nGoodbye.\n");
});

test("parsePatch reconstructs empty content for a Delete File patch", () => {
  const patch = ["*** Begin Patch", "*** Delete File: /tmp/obsolete.txt", "*** End Patch", ""].join(
    "\n",
  );

  const parsed = parsePatch(patch);

  expect(parsed).not.toBeNull();
  expect(parsed?.filePath).toBe("/tmp/obsolete.txt");
  expect(parsed?.tool).toBe("Write");
  expect(parsed?.content).toBe("");
});

test("extractPatchText returns null for a command array whose elements contain no marker", () => {
  const patchText = extractPatchText({ command: ["ls", "-la", "/tmp"] });

  expect(patchText).toBeNull();
});

test("an editor that changes nothing allows and prints nothing on stdout", () => {
  const harness = setupHarness();
  const editorScript = writeEditorScript(harness.targetDir, null);

  const payload = JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: harness.filePath, content: "hello\nworld\n" },
  });

  const outcome = runAdapter(payload, harness, editorScript);

  expect(outcome.status).toBe(0);
  expect(outcome.stdout).toBe("");
});

const CODEX_SESSION_ID = "b7c1a2f4-3d5e-4a6b-8c9d-0e1f2a3b4c5d";

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

test("a payload session id enables the codex hook through the session flag alone", () => {
  const harness = setupSessionOnlyHarness(CODEX_SESSION_ID);
  const editorScript = writeEditorScript(harness.targetDir, "why does this work?");

  const payload = JSON.stringify({
    session_id: CODEX_SESSION_ID,
    tool_name: "Write",
    tool_input: { file_path: harness.filePath, content: "hello\nworld\n" },
  });

  const outcome = runAdapter(payload, harness, editorScript);

  expect(outcome.status).toBe(0);
  const parsed: unknown = JSON.parse(outcome.stdout);
  expect(JSON.stringify(parsed)).toContain("why does this work?");
});

test("a payload with an unrelated session id leaves the codex hook off", () => {
  const harness = setupSessionOnlyHarness(CODEX_SESSION_ID);
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
