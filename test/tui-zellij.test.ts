import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, test } from "vitest";
import { createPairEditor } from "../src/editors/pair";
import { DEFAULT_CONFIG } from "../src/core/config";
import { fg, theme } from "../src/tui/paint/theme";
import { parseNoteResult } from "../src/core/collect";
import type { EditorContext } from "../src/editors/editor.types";

const REPO_ROOT = join(import.meta.dirname, "..");
const TUI_ENTRY = join(REPO_ROOT, "dist", "pair-tui.js");

const PAINT_POLL_INTERVAL_MS = 50;
const PAINT_POLL_TIMEOUT_MS = 5000;
const RESULT_POLL_INTERVAL_MS = 50;
const RESULT_POLL_TIMEOUT_MS = 5000;

const SOURCE_PATH = "fixture.txt";
const RIGHT_REPLACEMENT_MARKER = "TWO";
const RIGHT_REPLACEMENT_TEXT = "TWO changed";
const CTRL_S_BYTE = "19";

function zellijAction(args: string[]): string {
  return execFileSync("zellij", ["action", ...args], { encoding: "utf-8" });
}

function runFloatingPane(argv: string[]): string {
  const result = spawnSync("zellij", ["run", "--floating", "--close-on-exit", "--name", "pair", "--", ...argv], {
    encoding: "utf-8",
  });

  const paneId = result.stdout.trim();

  if (paneId === "") {
    throw new Error(`zellij run produced no pane id: stderr=${result.stderr}`);
  }

  return paneId;
}

function closePane(paneId: string): void {
  spawnSync("zellij", ["action", "close-pane", "-p", paneId]);
}

async function pollUntil(check: () => boolean, timeoutMs: number, intervalMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (check()) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return check();
}

function dumpScreen(paneId: string, ansi: boolean): string {
  const args = ansi ? ["dump-screen", "--ansi", "-p", paneId] : ["dump-screen", "-p", paneId];
  return zellijAction(args);
}

function writeFixture(dir: string): { leftFile: string; rightFile: string; resultFile: string } {
  const leftFile = join(dir, "left.txt");
  const rightFile = join(dir, "right.txt");
  const resultFile = join(dir, "result.json");

  writeFileSync(leftFile, "line one\nline two\nline three\n", "utf-8");
  writeFileSync(rightFile, `line one\nline ${RIGHT_REPLACEMENT_TEXT}\nline three\nline four added\n`, "utf-8");

  return { leftFile, rightFile, resultFile };
}

function launchArgv(leftFile: string, rightFile: string, resultFile: string): string[] {
  const context: EditorContext = {
    leftFile,
    rightFile,
    resultFile,
    sourcePath: SOURCE_PATH,
    theme: { add: "#1e3a1e", del: "#3a1e1e", fold: "#2a2a2a", rowBand: false },
    configDir: "/unused-config-dir",
    config: DEFAULT_CONFIG,
  };

  return createPairEditor(() => TUI_ENTRY).prepare(context).argv;
}

describe.skipIf(process.env["ZELLIJ"] === undefined)("live zellij checks", () => {
  test("the rendered screen carries the theme colours and the source basename", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "pair-mode-zellij-screen-"));
    const { leftFile, rightFile, resultFile } = writeFixture(scratch);
    const argv = launchArgv(leftFile, rightFile, resultFile);

    let paneId: string | null = null;

    try {
      paneId = runFloatingPane(argv);

      const painted = await pollUntil(
        () => dumpScreen(paneId!, false).includes(basename(SOURCE_PATH)),
        PAINT_POLL_TIMEOUT_MS,
        PAINT_POLL_INTERVAL_MS,
      );

      expect(painted).toBe(true);

      const screen = dumpScreen(paneId, true);

      const addTruecolor = fg(theme.addBar, true);
      const addAnsi16 = fg(theme.addBar, false);
      const delTruecolor = fg(theme.delBar, true);
      const delAnsi16 = fg(theme.delBar, false);

      expect(screen.includes(addTruecolor) || screen.includes(addAnsi16)).toBe(true);
      expect(screen.includes(delTruecolor) || screen.includes(delAnsi16)).toBe(true);
      expect(screen).toContain(basename(SOURCE_PATH));
    } finally {
      if (paneId !== null) {
        closePane(paneId);
      }

      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("a synthetic mouse drag anchors a note to the row it targeted", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "pair-mode-zellij-mouse-"));
    const { leftFile, rightFile, resultFile } = writeFixture(scratch);
    const argv = launchArgv(leftFile, rightFile, resultFile);

    let paneId: string | null = null;

    try {
      paneId = runFloatingPane(argv);

      const painted = await pollUntil(
        () => dumpScreen(paneId!, false).includes(RIGHT_REPLACEMENT_MARKER),
        PAINT_POLL_TIMEOUT_MS,
        PAINT_POLL_INTERVAL_MS,
      );

      expect(painted).toBe(true);

      const plainScreen = dumpScreen(paneId, false);
      const lines = plainScreen.split("\n");
      const targetLineIndex = lines.findIndex((line) => line.includes(RIGHT_REPLACEMENT_MARKER));

      expect(targetLineIndex).toBeGreaterThanOrEqual(0);

      const targetLine = lines[targetLineIndex]!;
      const startColumn = targetLine.indexOf(RIGHT_REPLACEMENT_MARKER) + 1;
      const endColumn = startColumn + RIGHT_REPLACEMENT_TEXT.length - 1;
      const terminalRow = targetLineIndex + 1;

      const press = `\x1b[<0;${startColumn};${terminalRow}M`;
      const drag = `\x1b[<32;${endColumn};${terminalRow}M`;
      const release = `\x1b[<0;${endColumn};${terminalRow}m`;

      zellijAction(["write-chars", "-p", paneId, press + drag + release]);
      zellijAction(["write-chars", "-p", paneId, "a"]);
      zellijAction(["write-chars", "-p", paneId, "why change this"]);
      zellijAction(["write-chars", "-p", paneId, "\r"]);
      zellijAction(["write", "-p", paneId, CTRL_S_BYTE]);

      const wrote = await pollUntil(
        () => existsSync(resultFile) && readFileSync(resultFile, "utf-8").trim() !== "",
        RESULT_POLL_TIMEOUT_MS,
        RESULT_POLL_INTERVAL_MS,
      );

      expect(wrote).toBe(true);

      const questions = parseNoteResult(readFileSync(resultFile, "utf-8"));

      expect(questions).toHaveLength(1);
      expect(questions[0]?.line).toBe(2);
    } finally {
      if (paneId !== null) {
        closePane(paneId);
      }

      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
