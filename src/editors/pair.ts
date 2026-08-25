import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { paintLayout } from "../core/config";
import type { Editor, EditorContext, EditorLaunch } from "./editor.types";
import type { BundleExistsChecker, TuiEntryResolver } from "./pair.types";

// The TUI bundles into the same dist/ directory as every editor's caller, so a sibling lookup survives an arbitrary install prefix.
const defaultResolveTuiEntry: TuiEntryResolver = () => {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "pair-tui.js");
};

const defaultCheckBundleExists: BundleExistsChecker = existsSync;

export function createPairEditor(
  resolveTuiEntry: TuiEntryResolver = defaultResolveTuiEntry,
  checkBundleExists: BundleExistsChecker = defaultCheckBundleExists,
): Editor {
  return {
    name: "pair",
    collectMode: "result-file",

    // auto falls through to the next candidate when the bundle is missing. An explicit editor: "pair" bypasses this and never calls available().
    available(): boolean {
      return checkBundleExists(resolveTuiEntry());
    },

    headerHint(): string[] {
      return [];
    },

    bufferSuffix(sourcePath: string): string {
      return extname(sourcePath);
    },

    prepare(context: EditorContext): EditorLaunch {
      const { config } = context;

      return {
        argv: [
          resolveTuiEntry(),
          "--left",
          context.leftFile,
          "--right",
          context.rightFile,
          "--path",
          context.sourcePath,
          "--result",
          context.resultFile,
          "--layout",
          paintLayout(config.layout),
          "--notes",
          config.notes,
          "--row-band",
          String(config.theme.rowBand),
          "--syntax",
          String(config.syntax),
          "--context",
          String(config.context),
          "--min-fold",
          String(config.minFold),
        ],
        env: {},
      };
    },
  };
}
