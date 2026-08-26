import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileIfChanged } from "./register";
import type { CliName, CommandSpec } from "./commands.types";
import type { RegisterResult } from "./types";

const DESCRIPTION =
  "Toggle pair mode. Every proposed edit opens in the pair review pane for line annotation.";

// Codex and pi load the file as a skill, so neither substitutes an argument placeholder.
const INFER_ACTION =
  "Read the action from the user's message, then run `pair-mode <action>` and report the resulting state in one line.";

const SPECS: Record<CliName, CommandSpec> = {
  "claude-code": {
    segments: [".claude", "commands", "pair.md"],
    frontMatter: [`description: ${DESCRIPTION}`, "allowed-tools: Bash(pair-mode:*)"],
    tools: "Write, Edit, and MultiEdit",
    invocation: "Run `pair-mode $ARGUMENTS` and report the resulting state in one line.",
  },
  codex: {
    segments: [".codex", "skills", "pair", "SKILL.md"],
    frontMatter: ["name: pair", `description: ${DESCRIPTION}`],
    tools: "apply_patch, Write, and Edit",
    invocation: INFER_ACTION,
  },
  opencode: {
    segments: [".config", "opencode", "commands", "pair.md"],
    frontMatter: [`description: ${DESCRIPTION}`],
    tools: "write and edit",
    invocation: "Run `pair-mode $ARGUMENTS` and report the resulting state in one line.",
  },
  pi: {
    segments: [".pi", "agent", "skills", "pair", "SKILL.md"],
    frontMatter: ["name: pair", `description: ${DESCRIPTION}`],
    tools: "write and edit",
    invocation: INFER_ACTION,
  },
};

export function pairCommandPath(homeDir: string, cli: CliName): string {
  return join(homeDir, ...SPECS[cli].segments);
}

export function pairCommandSource(cli: CliName): string {
  const spec = SPECS[cli];

  return [
    "---",
    ...spec.frontMatter,
    "---",
    "",
    spec.invocation,
    "",
    "With no action, run `pair-mode status`.",
    "",
    `Pair mode intercepts your ${spec.tools} calls. The user reads the proposed diff in the`,
    "pair review pane, selects lines, and attaches notes. Pair mode then holds the edit and",
    "returns those notes as questions anchored to line numbers. Answer every question. Do not",
    "re-attempt the edit until the user asks for it. An edit the user closes with no notes",
    "applies as proposed.",
    "",
    "Pair mode keys the flag by the real directory path, and the hook walks up from the edited",
    "file. A flag on a parent directory therefore covers every repo beneath it. If pair mode",
    "stays on after an `off`, check each parent with `pair-mode status <dir>`.",
    "",
  ].join("\n");
}

// A file that drifted from the canonical source reports as unregistered, so doctor asks for a re-run.
export function isPairCommandRegistered(homeDir: string, cli: CliName): boolean {
  const path = pairCommandPath(homeDir, cli);

  if (!existsSync(path)) {
    return false;
  }

  return readFileSync(path, "utf-8") === pairCommandSource(cli);
}

export function registerPairCommand(homeDir: string, cli: CliName): RegisterResult {
  return writeFileIfChanged(pairCommandPath(homeDir, cli), pairCommandSource(cli));
}
