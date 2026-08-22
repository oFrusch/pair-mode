import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// esbuild bundles every source file into dist/cli.js, so this URL always resolves to that file at runtime.
export function installRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..");
}
