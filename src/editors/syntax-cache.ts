import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RULES_MARKER = "\nrules:\n";

// The default root walks up from this module to find the shipped assets/syntax dir.
function defaultAssetsDir(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));

  while (true) {
    const candidate = join(dir, "assets", "syntax");

    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(dir);

    if (parent === dir) {
      return null;
    }

    dir = parent;
  }
}

export function ruleBody(
  lang: string,
  assetsDir: string | null = defaultAssetsDir(),
): string | null {
  if (assetsDir === null) {
    return null;
  }

  const path = join(assetsDir, `${lang}.yaml`);

  if (!existsSync(path)) {
    return null;
  }

  const text = readFileSync(path, "utf-8");
  const index = text.indexOf(RULES_MARKER);

  if (index === -1) {
    return null;
  }

  return text.slice(index + RULES_MARKER.length);
}
