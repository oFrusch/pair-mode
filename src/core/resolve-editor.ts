import type { PairConfig } from "./config.types";
import type { Editor, EditorContext, EditorLaunch } from "../editors/editor.types";
import { createMicroEditor } from "../editors/micro";

// A string array is a raw command. Task 10 adds a shared resolver in src/editors; until then this is the only indirection.
function createPassthroughEditor(command: string[]): Editor {
  return {
    name: "vim",

    available(): boolean {
      return true;
    },

    bufferSuffix(): string {
      return ".diff";
    },

    prepare(context: EditorContext): EditorLaunch {
      return { argv: [...command, context.leftFile, context.rightFile], env: {} };
    },
  };
}

export function resolveEditor(preference: PairConfig["editor"]): Editor {
  if (Array.isArray(preference)) {
    return createPassthroughEditor(preference);
  }

  return createMicroEditor();
}
