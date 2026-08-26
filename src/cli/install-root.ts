import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { EphemeralRoot } from "./install-root.types";

// npm and pnpm both stage a one-off package run under a cache directory they later prune.
const EPHEMERAL_SEGMENTS = ["_npx", ".npm-store", "_dlx"];

// esbuild bundles every source file into dist/cli.js, so this URL always resolves to that file at runtime.
export function installRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..");
}

// Setup writes this root as an absolute path into every CLI config, so a pruned cache leaves a dead hook.
export function describeEphemeralRoot(root: string): EphemeralRoot {
  const segments = root.split(sep);
  const match = EPHEMERAL_SEGMENTS.find((segment) => segments.includes(segment));

  if (match === undefined) {
    return { ephemeral: false, cache: null };
  }

  const upto = segments.slice(0, segments.indexOf(match) + 1);

  return { ephemeral: true, cache: upto.join(sep) };
}
