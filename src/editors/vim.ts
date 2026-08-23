import { extname } from "node:path";
import type { Editor, EditorContext, EditorLaunch, PathResolver } from "./editor.types";
import { syntaxName } from "./languages";
import { defaultResolvesOnPath } from "../helpers/resolvesOnPath";
import { isHexColor } from "../helpers/hexColor";

// The micro syntax name and the vim filetype name diverge only for these entries.
const VIM_FILETYPE_OVERRIDES: Record<string, string> = {
  python3: "python",
};

function vimFiletype(sourcePath: string): string | null {
  const lang = syntaxName(sourcePath);

  if (lang === null) {
    return null;
  }

  return VIM_FILETYPE_OVERRIDES[lang] ?? lang;
}

// A `|` in a vim -c string splits it into a second command, so guard here even though config.ts already validates hex upstream.
function safeThemeColor(value: string): string {
  if (!isHexColor(value)) {
    throw new Error(`invalid theme colour for vim highlight: ${value}`);
  }

  return value;
}

// matchadd() overlays a highlight on top of syntax, so a changed row keeps both.
function highlightCommands(theme: EditorContext["theme"]): string[] {
  return [
    `hi PairAdd guibg=${safeThemeColor(theme.add)}`,
    `hi PairDel guibg=${safeThemeColor(theme.del)}`,
    `hi PairFold guibg=${safeThemeColor(theme.fold)}`,
  ];
}

// windo applies each match in every window, so both split buffers carry the bands.
function matchCommands(): string[] {
  return [
    "windo call matchadd('PairAdd', '^▌▌+')",
    "windo call matchadd('PairDel', '^▌▌-')",
    "windo call matchadd('PairFold', '^⋯')",
  ];
}

function launchCommands(context: EditorContext): string[] {
  const commands = [...highlightCommands(context.theme), ...matchCommands()];
  const filetype = vimFiletype(context.sourcePath);

  if (filetype !== null) {
    commands.push(`set filetype=${filetype}`);
  }

  commands.push("set noswapfile");
  return commands;
}

export function vimEditor(
  name: "vim" | "nvim",
  resolvesOnPath: PathResolver = defaultResolvesOnPath,
): Editor {
  return {
    name,
    collectMode: "buffer-diff",

    available(): boolean {
      return resolvesOnPath(name);
    },

    bufferSuffix(sourcePath: string): string {
      return extname(sourcePath);
    },

    headerHint(): string[] {
      return ["# Save and quit both windows with :wqa."];
    },

    prepare(context: EditorContext): EditorLaunch {
      const flags = launchCommands(context).flatMap((command) => ["-c", command]);

      return {
        argv: [name, "-O", ...flags, context.leftFile, context.rightFile],
        env: {},
      };
    },
  };
}
