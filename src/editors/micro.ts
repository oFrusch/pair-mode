import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { Editor, EditorContext, EditorLaunch, PathResolver } from "./editor.types";
import type { BandRule, MicroSyntaxFile, MicroSyntaxSource } from "./micro.types";
import { syntaxName } from "./languages";
import { syntaxSource } from "./syntax-cache";
import { defaultResolvesOnPath } from "../helpers/resolvesOnPath";
import { isRecord } from "../helpers/isRecord";

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

function isMicroSyntaxSource(value: unknown): value is MicroSyntaxSource {
  return isRecord(value) && Array.isArray(value["rules"]);
}

// pairadd and pairskip need micro regions, not plain rules, or the row loses colour mid-line.
function bandRules(): BandRule[] {
  const region = (name: string, start: string): BandRule => ({
    [name]: { start, end: "$" },
  });

  return [
    region("pairadd", "^▌▌\\+"),
    region("pairdel", "^▌▌-"),
    region("pairskip", "^⋯"),
    region("comment", "^#"),
  ];
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

// Builds a real object, then hands it to the yaml library, so indentation is the serializer's problem, not ours.
export function syntaxText(lang: string, source: string): string | null {
  const parsed: unknown = parse(source);

  if (!isMicroSyntaxSource(parsed)) {
    return null;
  }

  const suffix = `.pair-${lang}`;

  const file: MicroSyntaxFile = {
    filetype: `pair-${lang}`,
    detect: { filename: `\\${suffix}$` },
    rules: [...parsed.rules, ...bandRules()],
  };

  return stringify(file, { lineWidth: 0 });
}

function writeSyntax(configDir: string, sourcePath: string): void {
  const lang = syntaxName(sourcePath);

  if (lang === null) {
    return;
  }

  const source = syntaxSource(lang);

  if (source === null) {
    return;
  }

  const text = syntaxText(lang, source);

  if (text === null) {
    return;
  }

  const dir = join(configDir, "syntax");
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, `pair-${lang}.yaml`), text, "utf-8");
}

export function createMicroEditor(resolvesOnPath: PathResolver = defaultResolvesOnPath): Editor {
  return {
    name: "micro",
    collectMode: "buffer-diff",

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

      return syntaxSource(lang) === null ? ".diff" : `.pair-${lang}`;
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
