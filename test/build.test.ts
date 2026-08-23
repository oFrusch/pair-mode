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

const entryPoints = ["cli.js", "claude-code.js", "codex.js", "opencode.js", "pi.js"];

for (const entry of entryPoints) {
  test(`dist/${entry} carries the node shebang and the executable bit`, () => {
    const path = join(repoRoot, "dist", entry);
    const text = readFileSync(path, "utf-8");

    expect(text.startsWith("#!/usr/bin/env node\n")).toBe(true);

    const mode = statSync(path).mode;
    expect(mode & 0o111).not.toBe(0);
  });
}
