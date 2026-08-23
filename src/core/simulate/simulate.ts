import type { EditRequest } from "../run";
import type { EditItem } from "./types";
import { isRecord } from "../../helpers/isRecord";

function isEditItem(value: unknown): value is EditItem {
  if (!isRecord(value)) {
    return false;
  }

  if ("old_string" in value && typeof value["old_string"] !== "string") {
    return false;
  }

  if ("new_string" in value && typeof value["new_string"] !== "string") {
    return false;
  }

  if ("replace_all" in value && typeof value["replace_all"] !== "boolean") {
    return false;
  }

  return true;
}

function getFilePath(input: Record<string, unknown>): string | null {
  const value = input["file_path"];
  return typeof value === "string" && value !== "" ? value : null;
}

function replaceFirst(text: string, old: string, next: string): string {
  if (old === "") {
    return next + text;
  }

  const index = text.indexOf(old);

  if (index === -1) {
    return text;
  }

  return text.slice(0, index) + next + text.slice(index + old.length);
}

// Python's str.replace("", x) inserts x before every character and once more at the end.
function replaceAllEmptyOld(text: string, next: string): string {
  return next + Array.from(text, (char) => char + next).join("");
}

export function applyEdit(text: string, edit: EditItem): string | null {
  const old = edit.old_string ?? "";
  const next = edit.new_string ?? "";

  if (old !== "" && !text.includes(old)) {
    return null;
  }

  if (edit.replace_all) {
    return old === "" ? replaceAllEmptyOld(text, next) : text.split(old).join(next);
  }

  return replaceFirst(text, old, next);
}

export function simulate(
  tool: string,
  input: unknown,
  readFile: (path: string) => string,
): EditRequest | null {
  if (!isRecord(input)) {
    return null;
  }

  const filePath = getFilePath(input);

  if (filePath === null) {
    return null;
  }

  if (tool === "Write") {
    const content = input["content"];
    const after = typeof content === "string" ? content : "";
    const before = readFile(filePath);

    return { tool, filePath, before, after };
  }

  if (tool === "Edit" || tool === "MultiEdit") {
    const editsRaw = input["edits"];
    const edits = Array.isArray(editsRaw) ? editsRaw : [input];
    const before = readFile(filePath);

    const after = edits.reduce<string | null>((current, rawEdit) => {
      if (current === null || !isEditItem(rawEdit)) {
        return null;
      }

      return applyEdit(current, rawEdit);
    }, before);

    if (after === null) {
      return null;
    }

    return { tool, filePath, before, after };
  }

  return null;
}
