// nano has no syntax engine here, so a changed row gets only the background band, no language colour.
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Editor, EditorContext, EditorLaunch, PathResolver } from "./editor.types";

// The default resolver shells out to `which` for a real PATH lookup.
const defaultResolvesOnPath: PathResolver = (command) => {
  const result = spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
};

function writeNanorc(configDir: string, theme: EditorContext["theme"]): string {
  const text =
    `color ,${theme.add} "^▌▌\\+"\n` + `color ,${theme.del} "^▌▌-"\n` + `color ,${theme.fold} "^⋯"\n`;

  const path = join(configDir, "pair.nanorc");
  writeFileSync(path, text, "utf-8");
  return path;
}

export function createNanoEditor(resolvesOnPath: PathResolver = defaultResolvesOnPath): Editor {
  return {
    name: "nano",

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
