import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import { configPath, loadConfig, saveConfig } from "../../core/config";
import type { EditorName, Layout, MultiplexerName, PairConfig } from "../../core/config";
import { detectInstalls } from "../detect";
import { installRoot } from "../install-root";
import { runDoctor } from "../doctor";
import {
  backupIfPresent,
  correctMultiEditMatchers,
  findMultiEditMatchers,
  registerClaudeCode,
  registerCodex,
  registerOpencode,
  registerPi,
} from "../register";
import type { Prompter, SetupOptions, SetupResult } from "./types";

const EDITOR_NAMES: EditorName[] = ["auto", "pair", "micro", "nvim", "vim", "nano"];
const MULTIPLEXER_NAMES: MultiplexerName[] = ["auto", "zellij", "tmux", "none"];
const LAYOUTS: Layout[] = ["split", "inline"];

function toEditorName(value: string): EditorName {
  return EDITOR_NAMES.find((name) => name === value) ?? "auto";
}

function toMultiplexerName(value: string): MultiplexerName {
  return MULTIPLEXER_NAMES.find((name) => name === value) ?? "auto";
}

function toLayout(value: string): Layout {
  return LAYOUTS.find((name) => name === value) ?? "split";
}

function createDefaultPrompter(): Prompter {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    question: (prompt: string) => rl.question(prompt),
    close: () => rl.close(),
  };
}

function withDefault(answer: string, fallback: string): string {
  const trimmed = answer.trim();
  return trimmed === "" ? fallback : trimmed;
}

function isYes(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "" || normalized === "y" || normalized === "yes";
}

function pushChanged(changedFiles: string[], path: string, backupPath: string | null): void {
  changedFiles.push(path);

  if (backupPath !== null) {
    changedFiles.push(backupPath);
  }
}

export async function runSetup(options: SetupOptions = {}): Promise<SetupResult> {
  const prompter = options.prompter ?? createDefaultPrompter();
  const home = options.homeDir ?? homedir();
  const root = options.installRoot ?? installRoot();
  const changedFiles: string[] = [];

  try {
    const report = detectInstalls({
      resolvesOnPath: options.resolvesOnPath,
      homeDir: home,
      checkPairBundle: options.checkPairBundle,
    });

    console.log("Detected on this machine:");

    report.clis.forEach((cli) => {
      console.log(`  ${cli.name}: ${cli.present ? "present" : "not found"} (${cli.configPath})`);
    });

    report.multiplexers.forEach((multiplexer) => {
      console.log(`  ${multiplexer.name}: ${multiplexer.onPath ? "on PATH" : "not on PATH"}`);
    });

    console.log(`  inside multiplexer: ${report.insideMultiplexer ?? "none"}`);

    report.editors.forEach((editor) => {
      console.log(`  ${editor.name}: ${editor.onPath ? "on PATH" : "not on PATH"}`);
    });

    // Seed every default from the existing config, not just from what's on PATH, so a re-run doesn't quietly reset a prior choice.
    const configFilePath = configPath(home);
    const existingConfig = loadConfig(configFilePath).config;

    const existingEditorLabel = Array.isArray(existingConfig.editor)
      ? existingConfig.editor.join(" ")
      : existingConfig.editor;
    const defaultEditor =
      existingEditorLabel !== "auto"
        ? existingEditorLabel
        : (report.editors.find((editor) => editor.onPath)?.name ?? "auto");
    const editorAnswer = withDefault(
      await prompter.question(`Editor [${defaultEditor}]: `),
      defaultEditor,
    );

    const onPathMultiplexer = report.multiplexers.find((multiplexer) => multiplexer.onPath)?.name;
    const defaultMultiplexer =
      existingConfig.multiplexer !== "auto"
        ? existingConfig.multiplexer
        : (report.insideMultiplexer ?? onPathMultiplexer ?? "none");
    const multiplexerAnswer = withDefault(
      await prompter.question(`Multiplexer [${defaultMultiplexer}]: `),
      defaultMultiplexer,
    );

    const defaultLayout = existingConfig.layout;
    const layoutAnswer = withDefault(
      await prompter.question(`Layout [${defaultLayout}]: `),
      defaultLayout,
    );

    const presentClis = report.clis.filter((cli) => cli.present).map((cli) => cli.name);
    const defaultClis = presentClis.join(",");
    const clisAnswer = withDefault(
      await prompter.question(
        `Register with which CLIs (comma-separated: claude-code,codex,opencode,pi) [${defaultClis}]: `,
      ),
      defaultClis,
    );
    const selectedClis = clisAnswer
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "");

    const hasMultiplexer =
      report.multiplexers.some((multiplexer) => multiplexer.onPath) ||
      report.insideMultiplexer !== null;
    const wantsHookOnlyCli = selectedClis.includes("claude-code") || selectedClis.includes("codex");

    if (!hasMultiplexer && wantsHookOnlyCli) {
      console.log(
        "No multiplexer was found on this machine. Pair mode cannot open an editor under Claude Code or Codex: a hook has no controlling terminal.",
      );
      const stopAnswer = await prompter.question("Stop here? [Y/n]: ");

      if (isYes(stopAnswer)) {
        return { changedFiles, stopped: true, doctorExitCode: 1 };
      }
    }

    // A blank answer to "Editor" keeps a previously configured custom editor array intact rather than collapsing it to a name.
    const editorValue: EditorName | string[] =
      editorAnswer === defaultEditor && Array.isArray(existingConfig.editor)
        ? existingConfig.editor
        : toEditorName(editorAnswer);

    const config: PairConfig = {
      ...existingConfig,
      editor: editorValue,
      multiplexer: toMultiplexerName(multiplexerAnswer),
      layout: toLayout(layoutAnswer),
    };

    const configBackupPath = backupIfPresent(configFilePath);
    saveConfig(config, configFilePath);
    changedFiles.push(configFilePath);

    if (configBackupPath !== null) {
      changedFiles.push(configBackupPath);
    }

    for (const name of selectedClis) {
      if (name === "claude-code") {
        const result = registerClaudeCode(home, root);

        if (result.error !== undefined) {
          console.log(result.error);
          continue;
        }

        if (result.changed) {
          pushChanged(changedFiles, result.path, result.backupPath);
          console.log(
            "Claude Code loads hooks at startup. Restart Claude Code for the hook to take effect.",
          );
        }

        continue;
      }

      if (name === "codex") {
        const badMatchers = findMultiEditMatchers(home);

        if (badMatchers.length > 0) {
          console.log(
            "Codex has no MultiEdit alias, so the existing matcher token matches nothing there.",
          );
          const fixAnswer = await prompter.question("Correct it now? [Y/n]: ");

          if (isYes(fixAnswer)) {
            const fixResult = correctMultiEditMatchers(home);

            if (fixResult.error !== undefined) {
              console.log(fixResult.error);
            } else if (fixResult.changed) {
              pushChanged(changedFiles, fixResult.path, fixResult.backupPath);

              if (fixResult.note !== undefined) {
                console.log(fixResult.note);
              }
            }
          }
        }

        const result = registerCodex(home, root);

        if (result.error !== undefined) {
          console.log(result.error);
          continue;
        }

        if (result.changed) {
          pushChanged(changedFiles, result.path, result.backupPath);
        }

        console.log(
          "Codex asks you to trust a hook definition once. Run /hooks inside Codex to trust it.",
        );
        continue;
      }

      if (name === "opencode") {
        const result = registerOpencode(home, root);

        if (result.changed) {
          pushChanged(changedFiles, result.path, result.backupPath);
        }

        continue;
      }

      if (name === "pi") {
        const result = registerPi(home, root);

        if (result.changed) {
          pushChanged(changedFiles, result.path, result.backupPath);
        }
      }
    }

    console.log("Files changed:");

    changedFiles.forEach((file) => {
      console.log(`  ${file}`);
    });

    const doctorReport = runDoctor({
      homeDir: home,
      installRoot: root,
      resolvesOnPath: options.resolvesOnPath,
    });
    console.log(doctorReport.text);

    return { changedFiles, stopped: false, doctorExitCode: doctorReport.exitCode };
  } finally {
    prompter.close();
  }
}
