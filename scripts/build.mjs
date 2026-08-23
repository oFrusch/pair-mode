import { build } from "esbuild";
import { existsSync, chmodSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Get directory context for ESM.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// Every entry point is a hook or CLI a shell invokes directly, so every one needs the shebang and the executable bit.
const SHEBANG = "#!/usr/bin/env node";

// esbuild leaves a bundled CJS dep's internal require() calls dynamic, which throws under ESM output unless a real require exists.
const REQUIRE_SHIM = 'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);';

// Define all entry points to build.
const entryPoints = [
  { src: "src/cli/index.ts", out: "dist/cli.js" },
  { src: "src/adapters/claude-code/claude-code.ts", out: "dist/claude-code.js" },
  { src: "src/adapters/codex/codex.ts", out: "dist/codex.js" },
  { src: "src/adapters/opencode/opencode.ts", out: "dist/opencode.js" },
  { src: "src/adapters/pi/pi.ts", out: "dist/pi.js" },
  { src: "src/tui/cli.ts", out: "dist/pair-tui.js", external: ["shiki"] },
];

// Check which entry points exist.
const tooBuild = [];
const toSkip = [];

for (const entry of entryPoints) {
  const fullSrcPath = path.resolve(projectRoot, entry.src);
  if (existsSync(fullSrcPath)) {
    tooBuild.push(entry);
  } else {
    toSkip.push(entry);
  }
}

// Print skip messages.
for (const entry of toSkip) {
  console.log(`skip ${entry.src} (not built yet)`);
}

// Build present entry points.
let hasError = false;

for (const entry of tooBuild) {
  try {
    const outfile = path.resolve(projectRoot, entry.out);

    await build({
      entryPoints: [path.resolve(projectRoot, entry.src)],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      external: entry.external ?? [],
      banner: { js: `${SHEBANG}\n${REQUIRE_SHIM}` },
    });

    chmodSync(outfile, 0o755);
    console.log(`built ${entry.out}`);
  } catch (err) {
    console.error(`error building ${entry.src}:`, err.message);
    hasError = true;
  }
}

// Exit with appropriate code.
process.exit(hasError ? 1 : 0);
