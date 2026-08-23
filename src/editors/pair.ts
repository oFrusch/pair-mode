import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Editor, EditorContext, EditorLaunch } from "./editor.types";
import type { TuiEntryResolver } from "./pair.types";

// runTui speaks "split" | "unified". PairConfig.layout speaks "split" | "inline", because "inline" already names the one-column layout there. This is the only place the two vocabularies meet.
function paintLayout(layout: EditorContext["config"]["layout"]): "split" | "unified" {
  return layout === "inline" ? "unified" : "split";
}

// The TUI bundles into the same dist/ directory as every editor's caller, so a sibling lookup survives an arbitrary install prefix.
const defaultResolveTuiEntry: TuiEntryResolver = () => {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "pair-tui.js");
};

export function createPairEditor(resolveTuiEntry: TuiEntryResolver = defaultResolveTuiEntry): Editor {
  return {
    name: "pair",
    collectMode: "result-file",

    available(): boolean {
      return true;
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
        ],
        env: {},
      };
    },
  };
}
