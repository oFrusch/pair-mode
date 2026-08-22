import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Editor, EditorContext, EditorLaunch, PathResolver } from "./editor.types";
import { syntaxName } from "./languages";
import { ruleBody } from "./syntax-cache";

const MICRO_BINDINGS = {
  F2: "QuitAll",
  CtrlW: "QuitAll",
  "Alt-s": "QuitAll",
  F3: "NextSplit",
  F4: "PreviousSplit",
};

const MICRO_SETTINGS = {
  softwrap: true,
  ruler: true,
  savehistory: false,
  autosave: 1,
  colorscheme: "pair",
};

// pairadd and pairskip need micro regions, not plain rules, or the row loses colour mid-line.
function bandRules(): string {
  return (
    '\n    - pairadd:\n        start: "^▌▌\\\\+"\n        end: "$"' +
    '\n    - pairdel:\n        start: "^▌▌-"\n        end: "$"' +
    '\n    - pairskip:\n        start: "^⋯"\n        end: "$"' +
    '\n    - comment:\n        start: "^#"\n        end: "$"\n'
  );
}

function syntaxHead(lang: string, suffix: string): string {
  return `filetype: pair-${lang}\n\ndetect:\n    filename: "\\\\${suffix}$"\n\nrules:\n`;
}

// The default resolver shells out to `which` for a real PATH lookup.
const defaultResolvesOnPath: PathResolver = (command) => {
  const result = spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
};

function writeColorScheme(configDir: string, theme: EditorContext["theme"]): void {
  const dir = join(configDir, "colorschemes");
  mkdirSync(dir, { recursive: true });

  const text =
    'include "monokai"\n\n' +
    `color-link pairadd "#d7ffd7,${theme.add}"\n` +
    `color-link pairdel "#ffd7d7,${theme.del}"\n` +
    `color-link pairskip "#6a6a6a,${theme.fold}"\n`;

  writeFileSync(join(dir, "pair.micro"), text, "utf-8");
}

function writeSyntax(configDir: string, sourcePath: string): void {
  const lang = syntaxName(sourcePath);

  if (lang === null) {
    return;
  }

  const rules = ruleBody(lang);

  if (rules === null) {
    return;
  }

  const suffix = `.pair-${lang}`;
  const dir = join(configDir, "syntax");
  mkdirSync(dir, { recursive: true });

  const text = syntaxHead(lang, suffix) + rules.trimEnd() + "\n" + bandRules();
  writeFileSync(join(dir, `pair-${lang}.yaml`), text, "utf-8");
}

export function createMicroEditor(resolvesOnPath: PathResolver = defaultResolvesOnPath): Editor {
  return {
    name: "micro",

    available(): boolean {
      return resolvesOnPath("micro");
    },

    headerHint(): string[] {
      return ["# F3 moves between panes. Ctrl+W or F2 sends and closes."];
    },

    bufferSuffix(sourcePath: string): string {
      const lang = syntaxName(sourcePath);

      if (lang === null) {
        return ".diff";
      }

      return ruleBody(lang) === null ? ".diff" : `.pair-${lang}`;
    },

    prepare(context: EditorContext): EditorLaunch {
      mkdirSync(context.configDir, { recursive: true });

      writeFileSync(join(context.configDir, "bindings.json"), JSON.stringify(MICRO_BINDINGS, null, 2), "utf-8");
      writeFileSync(join(context.configDir, "settings.json"), JSON.stringify(MICRO_SETTINGS, null, 2), "utf-8");
      writeColorScheme(context.configDir, context.theme);
      writeSyntax(context.configDir, context.sourcePath);

      return {
        argv: ["micro", "-multiopen", "vsplit", context.leftFile, context.rightFile],
        env: { MICRO_CONFIG_HOME: context.configDir },
      };
    },
  };
}
