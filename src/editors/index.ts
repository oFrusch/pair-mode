import type { PairConfig } from "../core/config";
import type { Editor, EditorContext, EditorLaunch, PathResolver } from "./editor.types";
import type { BundleExistsChecker } from "./pair.types";
import { createMicroEditor } from "./micro";
import { vimEditor } from "./vim";
import { createNanoEditor } from "./nano";
import { createPairEditor } from "./pair";
import { defaultResolvesOnPath } from "../helpers/resolvesOnPath";

// A string array is a raw command. It bypasses every adapter and every syntax feature.
function createPassthroughEditor(command: string[]): Editor {
  return {
    name: "custom",
    collectMode: "buffer-diff",

    available(): boolean {
      return true;
    },

    bufferSuffix(): string {
      return ".diff";
    },

    headerHint(): string[] {
      return ["# Save the right pane before you quit."];
    },

    prepare(context: EditorContext): EditorLaunch {
      return { argv: [...command, context.leftFile, context.rightFile], env: {} };
    },
  };
}

function candidates(resolvesOnPath: PathResolver, checkPairBundle?: BundleExistsChecker): Editor[] {
  return [
    checkPairBundle ? createPairEditor(undefined, checkPairBundle) : createPairEditor(),
    createMicroEditor(resolvesOnPath),
    vimEditor("nvim", resolvesOnPath),
    vimEditor("vim", resolvesOnPath),
    createNanoEditor(resolvesOnPath),
  ];
}

export function resolve(
  preference: PairConfig["editor"],
  resolvesOnPath: PathResolver = defaultResolvesOnPath,
  checkPairBundle?: BundleExistsChecker,
): Editor {
  if (Array.isArray(preference)) {
    return createPassthroughEditor(preference);
  }

  // An explicit editor: "pair" resolves unconditionally, so a misconfigured install fails loudly instead of silently downgrading.
  if (preference === "pair") {
    return createPairEditor();
  }

  if (preference === "micro") {
    return createMicroEditor(resolvesOnPath);
  }

  if (preference === "vim" || preference === "nvim") {
    return vimEditor(preference, resolvesOnPath);
  }

  if (preference === "nano") {
    return createNanoEditor(resolvesOnPath);
  }

  const available = candidates(resolvesOnPath, checkPairBundle).find((candidate) => candidate.available());

  return available ?? vimEditor("vim", resolvesOnPath);
}

export function describe(resolvesOnPath: PathResolver = defaultResolvesOnPath): string[] {
  return candidates(resolvesOnPath).map(
    (editor) => `${editor.name}: ${editor.available() ? "available" : "not available"}`,
  );
}
