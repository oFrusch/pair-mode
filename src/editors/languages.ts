import { extname } from "node:path";

// Source extension to the micro syntax name that highlights it.
const LANGS: Record<string, string> = {
  ".go": "go",
  ".rb": "ruby",
  ".rake": "ruby",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".py": "python3",
  ".ex": "elixir",
  ".exs": "elixir",
  ".rs": "rust",
  ".sh": "sh",
  ".bash": "sh",
  ".fish": "fish",
  ".zsh": "zsh",
  ".sql": "sql",
  ".json": "json",
  ".tf": "terraform",
  ".proto": "proto",
  ".dockerfile": "dockerfile",
  ".toml": "toml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".md": "markdown",
  ".css": "css",
  ".html": "html",
  ".erb": "html",
  ".lua": "lua",
  ".c": "c",
  ".h": "c",
};

export function syntaxName(sourcePath: string): string | null {
  const ext = extname(sourcePath).toLowerCase();
  return LANGS[ext] ?? null;
}
