import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Editor, EditorContext, EditorLaunch, PathResolver, SyntaxIndent } from "./editor.types";
import { syntaxName } from "./languages";
import { ruleBody } from "./syntax-cache";
import { defaultResolvesOnPath } from "../helpers/resolvesOnPath";

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

// The upstream vendored files indent rules with 2 spaces, but nothing guarantees that stays true.
function ruleIndent(rules: string): SyntaxIndent {
  const itemMatch = rules.match(/^( +)-\s/m);
  const itemIndent = itemMatch?.[1] ?? "  ";

  const nestedMatch = rules.match(/^( +)start:\s/m);
  const nestedIndent = nestedMatch?.[1] ?? itemIndent + "  " + itemIndent;

  return { itemIndent, nestedIndent };
}

// pairadd and pairskip need micro regions, not plain rules, or the row loses colour mid-line.
function bandRules({ itemIndent: indent, nestedIndent: nested }: SyntaxIndent): string {
  const region = (name: string, start: string): string =>
    `\n${indent}- ${name}:\n${nested}start: "${start}"\n${nested}end: "$"`;

  return (
    region("pairadd", "^▌▌\\\\+") +
    region("pairdel", "^▌▌-") +
    region("pairskip", "^⋯") +
    region("comment", "^#") +
    "\n"
  );
}

function syntaxHead(lang: string, suffix: string): string {
  return `filetype: pair-${lang}\n\ndetect:\n    filename: "\\\\${suffix}$"\n\nrules:\n`;
}

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

// Pure text builder, split out from the filesystem write so tests can parse it without a fake source path.
export function syntaxText(lang: string, rules: string): string {
  const suffix = `.pair-${lang}`;

  return syntaxHead(lang, suffix) + rules.trimEnd() + "\n" + bandRules(ruleIndent(rules));
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

  const dir = join(configDir, "syntax");
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, `pair-${lang}.yaml`), syntaxText(lang, rules), "utf-8");
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

      writeFileSync(
        join(context.configDir, "bindings.json"),
        JSON.stringify(MICRO_BINDINGS, null, 2),
        "utf-8",
      );
      writeFileSync(
        join(context.configDir, "settings.json"),
        JSON.stringify(MICRO_SETTINGS, null, 2),
        "utf-8",
      );
      writeColorScheme(context.configDir, context.theme);
      writeSyntax(context.configDir, context.sourcePath);

      return {
        argv: ["micro", "-multiopen", "vsplit", context.leftFile, context.rightFile],
        env: { MICRO_CONFIG_HOME: context.configDir },
      };
    },
  };
}
