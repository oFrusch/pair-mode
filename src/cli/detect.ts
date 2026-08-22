import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  CliDetection,
  CliName,
  DetectAdapters,
  EditorDetection,
  InstallReport,
  MultiplexerDetection,
  PathResolver,
} from "./detect.types";

// The default resolver shells out to `which` for a real PATH lookup.
const defaultResolvesOnPath: PathResolver = (command) => {
  const result = spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
};

interface CliSpec {
  name: CliName;
  binary: string;
  configPath: (home: string) => string;
  configDir: (home: string) => string;
}

// The four install targets from the brief, with the binary that would register their own CLI and the config location Task 11 writes to.
const CLI_SPECS: CliSpec[] = [
  {
    name: "claude-code",
    binary: "claude",
    configPath: (home) => join(home, ".claude", "settings.json"),
    configDir: (home) => join(home, ".claude"),
  },
  {
    name: "codex",
    binary: "codex",
    configPath: (home) => join(home, ".codex", "hooks.json"),
    configDir: (home) => join(home, ".codex"),
  },
  {
    name: "opencode",
    binary: "opencode",
    configPath: (home) => join(home, ".config", "opencode"),
    configDir: (home) => join(home, ".config", "opencode"),
  },
  {
    name: "pi",
    binary: "pi",
    configPath: (home) => join(home, ".pi", "agent"),
    configDir: (home) => join(home, ".pi", "agent"),
  },
];

function detectClis(home: string, resolvesOnPath: PathResolver): CliDetection[] {
  return CLI_SPECS.map((spec) => ({
    name: spec.name,
    present: resolvesOnPath(spec.binary) || existsSync(spec.configDir(home)),
    configPath: spec.configPath(home),
  }));
}

function detectMultiplexers(resolvesOnPath: PathResolver): MultiplexerDetection[] {
  return [
    { name: "zellij", onPath: resolvesOnPath("zellij") },
    { name: "tmux", onPath: resolvesOnPath("tmux") },
  ];
}

// Env vars, not availability, say which multiplexer the current shell is actually inside.
function detectInsideMultiplexer(): string | null {
  if (process.env["ZELLIJ"]) {
    return "zellij";
  }

  if (process.env["TMUX"]) {
    return "tmux";
  }

  return null;
}

function detectEditors(resolvesOnPath: PathResolver): EditorDetection[] {
  return [
    { name: "micro", onPath: resolvesOnPath("micro") },
    { name: "nvim", onPath: resolvesOnPath("nvim") },
    { name: "vim", onPath: resolvesOnPath("vim") },
    { name: "nano", onPath: resolvesOnPath("nano") },
  ];
}

export function detectInstalls(adapters: DetectAdapters = {}): InstallReport {
  const resolvesOnPath = adapters.resolvesOnPath ?? defaultResolvesOnPath;
  const home = adapters.homeDir ?? homedir();

  return {
    clis: detectClis(home, resolvesOnPath),
    multiplexers: detectMultiplexers(resolvesOnPath),
    insideMultiplexer: detectInsideMultiplexer(),
    editors: detectEditors(resolvesOnPath),
  };
}
