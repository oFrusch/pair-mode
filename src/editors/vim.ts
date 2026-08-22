import { spawnSync } from "node:child_process";
import { extname } from "node:path";
import type { Editor, EditorContext, EditorLaunch, PathResolver } from "./editor.types";
import { syntaxName } from "./languages";

// The micro syntax name and the vim filetype name diverge only for these entries.
const VIM_FILETYPE_OVERRIDES: Record<string, string> = {
  python3: "python",
};

// The default resolver shells out to `which` for a real PATH lookup.
const defaultResolvesOnPath: PathResolver = (command) => {
  const result = spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
};

function vimFiletype(sourcePath: string): string | null {
  const lang = syntaxName(sourcePath);

  if (lang === null) {
    return null;
  }

  return VIM_FILETYPE_OVERRIDES[lang] ?? lang;
}

// matchadd() overlays a highlight on top of syntax, so a changed row keeps both.
function highlightCommands(theme: EditorContext["theme"]): string[] {
  return [`hi PairAdd guibg=${theme.add}`, `hi PairDel guibg=${theme.del}`, `hi PairFold guibg=${theme.fold}`];
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

export function vimEditor(name: "vim" | "nvim", resolvesOnPath: PathResolver = defaultResolvesOnPath): Editor {
  return {
    name,

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
      const flags: string[] = [];

      for (const command of launchCommands(context)) {
        flags.push("-c", command);
      }

      return {
        argv: [name, "-O", ...flags, context.leftFile, context.rightFile],
        env: {},
      };
    },
  };
}
