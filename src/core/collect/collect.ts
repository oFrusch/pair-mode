import { opcodes } from "../diff";
import { isRecord } from "../../helpers/isRecord";
import type { Question } from "./types";

export function anchor(
  original: string[],
  numbers: (number | null)[],
  index: number,
): { line: number | null; code: string } {
  const preceding = numbers.slice(0, index + 1);
  const i = preceding.findLastIndex((number) => number !== undefined && number !== null);

  if (i === -1) {
    return { line: null, code: "" };
  }

  const code = original[i];
  return { line: preceding[i] ?? null, code: code ?? "" };
}

export function collect(
  original: string[],
  numbers: (number | null)[],
  saved: string[],
): Question[] {
  return opcodes(original, saved)
    .filter((op) => op.tag !== "equal" && op.tag !== "delete")
    .flatMap((op) => {
      const { line, code } = anchor(original, numbers, op.i1 - 1);

      return Array.from({ length: op.j2 - op.j1 }, (_, offset) => op.j1 + offset)
        .map((j) => ({ line, code, text: (saved[j] ?? "").trim() }))
        .filter((question) => question.text !== "");
    });
}

export function formatQuestions(questions: Question[], path: string): string {
  const header: string[] = [
    `PAIR MODE. The user annotated your proposed change to ${path}.`,
    "The edit was NOT applied. Answer every question below.",
    "Do not re-attempt the edit until the user tells you to.",
    "",
  ];

  const body = questions.flatMap((question) => {
    const lineText = question.line !== null ? [`  line ${question.line}: ${question.code}`] : [];

    return [...lineText, `       Q: ${question.text}`, ""];
  });

  return [...header, ...body].join("\n");
}

function parseNoteEntry(entry: unknown): Question[] {
  if (!isRecord(entry)) {
    return [];
  }

  const { line, code, text } = entry;

  if (typeof line !== "number" && line !== null) {
    return [];
  }

  if (typeof code !== "string" || typeof text !== "string") {
    return [];
  }

  const trimmed = text.trim();

  if (trimmed === "") {
    return [];
  }

  return [{ line, code, text: trimmed }];
}

export function parseNoteResult(text: string): Question[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  if (!isRecord(parsed) || !Array.isArray(parsed["questions"])) {
    return [];
  }

  return parsed["questions"].flatMap(parseNoteEntry);
}
