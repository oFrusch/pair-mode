import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, beforeAll } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

beforeAll(() => {
  const result = spawnSync("node", [join(repoRoot, "scripts/build.mjs")], {
    cwd: repoRoot,
    encoding: "utf-8",
  });

  expect(result.status).toBe(0);
});

const entryPoints = ["cli.js", "claude-code.js", "codex.js", "opencode.js", "pi.js", "pair-tui.js"];

for (const entry of entryPoints) {
  test(`dist/${entry} carries the node shebang and the executable bit`, () => {
    const path = join(repoRoot, "dist", entry);
    const text = readFileSync(path, "utf-8");

    expect(text.startsWith("#!/usr/bin/env node\n")).toBe(true);

    const mode = statSync(path).mode;
    expect(mode & 0o111).not.toBe(0);
  });
}

// A banner collision or a duplicate hoisted import throws at parse time, which no unit test on src would catch.
for (const entry of entryPoints) {
  test(`dist/${entry} parses under node`, () => {
    const path = join(repoRoot, "dist", entry);
    const result = spawnSync(
      "node",
      ["--input-type=module", "-e", `await import("file://${path}")`],
      {
        cwd: repoRoot,
        encoding: "utf-8",
      },
    );

    expect(result.stderr).not.toContain("SyntaxError");
    expect(result.stderr).not.toContain("ReferenceError");
  });
}

// shiki is marked external for this entry, so its bundled grammars must never land inside pair-tui.js.
const SHIKI_BUNDLE_SIZE_CEILING_BYTES = 500_000;

test("dist/pair-tui.js stays small because shiki is external, not bundled", () => {
  const path = join(repoRoot, "dist", "pair-tui.js");
  const size = statSync(path).size;

  expect(size).toBeLessThan(SHIKI_BUNDLE_SIZE_CEILING_BYTES);
});
