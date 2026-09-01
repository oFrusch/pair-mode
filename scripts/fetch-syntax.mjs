import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "assets", "syntax");

// Each entry names an asset in MICRO_SYNTAX in src/editors/languages.ts.
const LANGS = [
  "c",
  "clojure",
  "cmake",
  "crystal",
  "csharp",
  "css",
  "dart",
  "dockerfile",
  "elixir",
  "elm",
  "erb",
  "erlang",
  "fish",
  "fsharp",
  "go",
  "graphql",
  "groovy",
  "haml",
  "haskell",
  "html",
  "ini",
  "java",
  "javascript",
  "json",
  "julia",
  "kotlin",
  "lua",
  "makefile",
  "markdown",
  "nginx",
  "nim",
  "nix",
  "objc",
  "ocaml",
  "perl",
  "php",
  "proto",
  "python3",
  "r",
  "ruby",
  "rust",
  "scala",
  "sh",
  "sql",
  "svelte",
  "swift",
  "terraform",
  "toml",
  "typescript",
  "vue",
  "xml",
  "yaml",
  "zig",
  "zsh",
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
