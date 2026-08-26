import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileIfChanged } from "./register";
import type { CliName, CommandSpec } from "./commands.types";
import type { RegisterResult } from "./types";

const DESCRIPTION =
  "Toggle pair mode. Every proposed edit opens in the pair review pane for line annotation.";

const SPECS: CommandSpec[] = [
  {
    cli: "claude-code",
    segments: [".claude", "commands", "pair.md"],
    frontMatter: [`description: ${DESCRIPTION}`, "allowed-tools: Bash(pair-mode:*)"],
    tools: "Write, Edit, and MultiEdit",
    invocation: "Run `pair-mode $ARGUMENTS` and report the resulting state in one line.",
  },
  {
    cli: "codex",
    segments: [".codex", "prompts", "pair.md"],
    frontMatter: [`description: ${DESCRIPTION}`, "argument-hint: on | off | status"],
    tools: "apply_patch, Write, and Edit",
    invocation: "Run `pair-mode $ARGUMENTS` and report the resulting state in one line.",
  },
  {
    cli: "opencode",
    segments: [".config", "opencode", "commands", "pair.md"],
    frontMatter: [`description: ${DESCRIPTION}`],
    tools: "write, edit, and patch",
    invocation: "Run `pair-mode $ARGUMENTS` and report the resulting state in one line.",
  },
  {
    cli: "pi",
    segments: [".pi", "agent", "skills", "pair", "SKILL.md"],
    frontMatter: ["name: pair", `description: ${DESCRIPTION}`],
    tools: "write and edit",
    invocation:
      "Read the action from the user's message, then run `pair-mode <action>` and report the resulting state in one line.",
  },
];

function findSpec(cli: CliName): CommandSpec {
  const spec = SPECS.find((candidate) => candidate.cli === cli);

  if (spec === undefined) {
    throw new Error(`no pair command spec for ${cli}`);
  }

  return spec;
}

export function pairCommandPath(homeDir: string, cli: CliName): string {
  return join(homeDir, ...findSpec(cli).segments);
}

export function pairCommandSource(cli: CliName): string {
  const spec = findSpec(cli);

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
    "re-attempt the edit until the user asks for it.",
    "",
    "Pair mode keys the flag by the real directory path, and the hook walks up from the edited",
    "file. A flag on a parent directory therefore covers every repo beneath it. If pair mode",
    "stays on after an `off`, check each parent with `pair-mode status <dir>`.",
    "",
  ].join("\n");
}

export function isPairCommandRegistered(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  return readFileSync(path, "utf-8").includes("pair-mode");
}

export function registerPairCommand(homeDir: string, cli: CliName): RegisterResult {
  return writeFileIfChanged(pairCommandPath(homeDir, cli), pairCommandSource(cli));
}
