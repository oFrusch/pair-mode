import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "assets", "syntax");

// Kept in sync by hand with the unique syntax names in src/editors/languages.ts.
const LANGS = [
  "go",
  "ruby",
  "typescript",
  "javascript",
  "python3",
  "elixir",
  "rust",
  "sh",
  "fish",
  "zsh",
  "sql",
  "json",
  "terraform",
  "proto",
  "dockerfile",
  "toml",
  "yaml",
  "markdown",
  "css",
  "html",
  "lua",
  "c",
];

const SYNTAX_URL =
  "https://raw.githubusercontent.com/micro-editor/micro/master/runtime/syntax/{}.yaml";
const force = process.argv.includes("--force");

mkdirSync(outDir, { recursive: true });

let hasError = false;

for (const lang of LANGS) {
  const target = path.join(outDir, `${lang}.yaml`);

  if (existsSync(target) && !force) {
    console.log(`skip ${lang} (cached)`);
    continue;
  }

  const url = SYNTAX_URL.replace("{}", lang);

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    writeFileSync(target, text, "utf-8");
    console.log(`fetched ${lang}`);
  } catch (err) {
    console.error(`failed ${lang}: ${err.message}`);
    hasError = true;
  }
}

process.exit(hasError ? 1 : 0);
