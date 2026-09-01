import { openSync, readSync, closeSync } from "node:fs";
import { basename, extname } from "node:path";
import type { LanguageId, ShebangRule } from "./languages.types";

// Source extension to the canonical language id.
const EXTENSIONS: Record<string, LanguageId> = {
  ".go": "go",
  ".rb": "ruby",
  ".rake": "ruby",
  ".gemspec": "ruby",
  ".ru": "ruby",
  ".erb": "erb",
  ".haml": "haml",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "jsx",
  ".vue": "vue",
  ".svelte": "svelte",
  ".astro": "astro",
  ".py": "python",
  ".pyi": "python",
  ".ex": "elixir",
  ".exs": "elixir",
  ".heex": "elixir",
  ".erl": "erlang",
  ".hrl": "erlang",
  ".rs": "rust",
  ".sh": "shellscript",
  ".bash": "shellscript",
  ".ksh": "shellscript",
  ".zsh": "zsh",
  ".fish": "fish",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".bat": "bat",
  ".cmd": "bat",
  ".sql": "sql",
  ".json": "json",
  ".jsonc": "jsonc",
  ".json5": "json5",
  ".tf": "terraform",
  ".tfvars": "terraform",
  ".hcl": "hcl",
  ".proto": "proto",
  ".dockerfile": "docker",
  ".toml": "toml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".ini": "ini",
  ".cfg": "ini",
  ".properties": "properties",
  ".env": "dotenv",
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdx": "mdx",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".styl": "stylus",
  ".html": "html",
  ".htm": "html",
  ".xml": "xml",
  ".xsl": "xml",
  ".svg": "xml",
  ".lua": "lua",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".cs": "csharp",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".m": "objective-c",
  ".mm": "objective-c",
  ".php": "php",
  ".pl": "perl",
  ".pm": "perl",
  ".scala": "scala",
  ".sc": "scala",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".cljc": "clojure",
  ".hs": "haskell",
  ".nix": "nix",
  ".r": "r",
  ".jl": "julia",
  ".zig": "zig",
  ".nim": "nim",
  ".dart": "dart",
  ".groovy": "groovy",
  ".gradle": "groovy",
  ".cr": "crystal",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".fs": "fsharp",
  ".fsx": "fsharp",
  ".elm": "elm",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".prisma": "prisma",
  ".sol": "solidity",
  ".vim": "viml",
  ".diff": "diff",
  ".patch": "diff",
  ".tex": "latex",
  ".wgsl": "wgsl",
  ".glsl": "glsl",
  ".cue": "cue",
};

// A file the toolchain names exactly, with no extension to read.
const FILENAMES: Record<string, LanguageId> = {
  gemfile: "ruby",
  rakefile: "ruby",
  capfile: "ruby",
  vagrantfile: "ruby",
  guardfile: "ruby",
  podfile: "ruby",
  fastfile: "ruby",
  appfile: "ruby",
  brewfile: "ruby",
  "config.ru": "ruby",
  dockerfile: "docker",
  containerfile: "docker",
  makefile: "make",
  gnumakefile: "make",
  "cmakelists.txt": "cmake",
  "cargo.lock": "toml",
  "gemfile.lock": "toml",
  ".babelrc": "json",
  ".eslintrc": "json",
  ".prettierrc": "json",
  ".env": "dotenv",
  ".gitconfig": "ini",
  ".editorconfig": "ini",
  "nginx.conf": "nginx",
  "pnpm-workspace.yaml": "yaml",
};

// The interpreter an extensionless script names on its first line.
const SHEBANGS: ShebangRule[] = [
  { pattern: /^#!.*\/(env\s+)?ruby(\s|$)/, id: "ruby" },
  { pattern: /^#!.*\/(env\s+)?python[\d.]*(\s|$)/, id: "python" },
  { pattern: /^#!.*\/(env\s+)?(node|bun|deno)(\s|$)/, id: "javascript" },
  { pattern: /^#!.*\/(env\s+)?(bash|sh|ksh|dash)(\s|$)/, id: "shellscript" },
  { pattern: /^#!.*\/(env\s+)?zsh(\s|$)/, id: "zsh" },
  { pattern: /^#!.*\/(env\s+)?fish(\s|$)/, id: "fish" },
  { pattern: /^#!.*\/(env\s+)?perl(\s|$)/, id: "perl" },
  { pattern: /^#!.*\/(env\s+)?php(\s|$)/, id: "php" },
  { pattern: /^#!.*\/(env\s+)?(elixir|iex)(\s|$)/, id: "elixir" },
  { pattern: /^#!.*\/(env\s+)?lua(\s|$)/, id: "lua" },
  { pattern: /^#!.*\/(env\s+)?Rscript(\s|$)/, id: "r" },
  { pattern: /^#!.*\/(env\s+)?pwsh(\s|$)/, id: "powershell" },
];

const FIRST_LINE_BYTES = 256;

// A shebang read must never break a review, so any filesystem failure degrades to no language.
function firstLine(sourcePath: string): string | null {
  let handle: number | null = null;

  try {
    handle = openSync(sourcePath, "r");
    const buffer = Buffer.alloc(FIRST_LINE_BYTES);
    const read = readSync(handle, buffer, 0, FIRST_LINE_BYTES, 0);
    const text = buffer.toString("utf-8", 0, read);
    const newline = text.indexOf("\n");

    return newline === -1 ? text : text.slice(0, newline);
  } catch {
    return null;
  } finally {
    if (handle !== null) {
      try {
        closeSync(handle);
      } catch {
        // A close failure cannot change the answer, so it stays silent.
      }
    }
  }
}

function shebangLanguage(sourcePath: string): LanguageId | null {
  const line = firstLine(sourcePath);

  if (line === null || !line.startsWith("#!")) {
    return null;
  }

  return SHEBANGS.find((rule) => rule.pattern.test(line))?.id ?? null;
}

// The extension wins, then the exact filename, then the shebang on disk.
export function detectLanguage(sourcePath: string): LanguageId | null {
  const name = basename(sourcePath).toLowerCase();
  const ext = extname(name);

  if (ext !== "" && EXTENSIONS[ext] !== undefined) {
    return EXTENSIONS[ext];
  }

  if (FILENAMES[name] !== undefined) {
    return FILENAMES[name];
  }

  return shebangLanguage(sourcePath);
}

// A micro syntax asset the repo ships, keyed by the canonical id that names it.
const MICRO_SYNTAX: Record<LanguageId, string> = {
  c: "c",
  clojure: "clojure",
  cmake: "cmake",
  crystal: "crystal",
  csharp: "csharp",
  css: "css",
  dart: "dart",
  docker: "dockerfile",
  elixir: "elixir",
  elm: "elm",
  erb: "erb",
  erlang: "erlang",
  fish: "fish",
  fsharp: "fsharp",
  go: "go",
  graphql: "graphql",
  groovy: "groovy",
  haml: "haml",
  haskell: "haskell",
  html: "html",
  ini: "ini",
  java: "java",
  javascript: "javascript",
  json: "json",
  julia: "julia",
  kotlin: "kotlin",
  lua: "lua",
  make: "makefile",
  markdown: "markdown",
  nginx: "nginx",
  nim: "nim",
  nix: "nix",
  "objective-c": "objc",
  ocaml: "ocaml",
  perl: "perl",
  php: "php",
  proto: "proto",
  python: "python3",
  r: "r",
  ruby: "ruby",
  rust: "rust",
  scala: "scala",
  shellscript: "sh",
  sql: "sql",
  svelte: "svelte",
  swift: "swift",
  terraform: "terraform",
  toml: "toml",
  typescript: "typescript",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  zig: "zig",
  zsh: "zsh",
};

// The canonical id and the vim filetype diverge only for these entries.
const VIM_FILETYPES: Record<LanguageId, string> = {
  shellscript: "sh",
  docker: "dockerfile",
  csharp: "cs",
  "objective-c": "objc",
  bat: "dosbatch",
  viml: "vim",
  mdx: "markdown",
  jsx: "javascriptreact",
  tsx: "typescriptreact",
  dotenv: "sh",
  properties: "jproperties",
  stylus: "stylus",
};

// Shiki bundles every canonical id, so the id passes straight through.
export function shikiLanguage(sourcePath: string): LanguageId | null {
  return detectLanguage(sourcePath);
}

// Only the languages with a shipped asset answer here, because micro reads a file.
export function microSyntaxName(sourcePath: string): string | null {
  const id = detectLanguage(sourcePath);

  if (id === null) {
    return null;
  }

  return MICRO_SYNTAX[id] ?? null;
}

export function vimFiletype(sourcePath: string): string | null {
  const id = detectLanguage(sourcePath);

  if (id === null) {
    return null;
  }

  return VIM_FILETYPES[id] ?? id;
}

export function knownExtensions(): string[] {
  return Object.keys(EXTENSIONS);
}

export function microSyntaxAssets(): string[] {
  return Object.values(MICRO_SYNTAX);
}

export function languageIds(): LanguageId[] {
  const ids = [
    ...Object.values(EXTENSIONS),
    ...Object.values(FILENAMES),
    ...SHEBANGS.map((rule) => rule.id),
  ];

  return [...new Set(ids)];
}
