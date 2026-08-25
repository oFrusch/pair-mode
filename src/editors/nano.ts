// nano has no syntax engine here, so a changed row gets only the background band, no language colour.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Editor, EditorContext, EditorLaunch, PathResolver } from "./editor.types";
import { defaultResolvesOnPath } from "../helpers/resolvesOnPath";
import { isHexColor } from "../helpers/hexColor";

// A space or comma in a nanorc colour field shifts the following unquoted tokens, so guard here even though config.ts already validates hex upstream.
function safeThemeColor(value: string): string {
  if (!isHexColor(value)) {
    throw new Error(`invalid theme colour for nano rcfile: ${value}`);
  }

  return value;
}

function writeNanorc(configDir: string, theme: EditorContext["theme"]): string {
  const text =
    `color ,${safeThemeColor(theme.add)} "^▌▌\\+"\n` +
    `color ,${safeThemeColor(theme.del)} "^▌▌-"\n` +
    `color ,${safeThemeColor(theme.fold)} "^⋯"\n`;

  const path = join(configDir, "pair.nanorc");
  writeFileSync(path, text, "utf-8");
  return path;
}

export function createNanoEditor(resolvesOnPath: PathResolver = defaultResolvesOnPath): Editor {
  return {
    name: "nano",
    collectMode: "buffer-diff",

    available(): boolean {
      return resolvesOnPath("nano");
    },

    bufferSuffix(): string {
      return ".diff";
    },

    headerHint(): string[] {
      return ["# Save with Ctrl+O, then exit with Ctrl+X."];
    },

    prepare(context: EditorContext): EditorLaunch {
      mkdirSync(context.configDir, { recursive: true });
      const rcfile = writeNanorc(context.configDir, context.theme);

      return {
        argv: ["nano", "--rcfile", rcfile, "-F", context.leftFile, context.rightFile],
        env: {},
      };
    },
  };
}
