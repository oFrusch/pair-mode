import { opcodes } from "./diff";
import type { Question } from "./collect.types";

export function anchor(
  original: string[],
  numbers: (number | null)[],
  index: number,
): { line: number | null; code: string } {
  for (let i = index; i >= 0; i -= 1) {
    const number = numbers[i];

    if (number !== undefined && number !== null) {
      const code = original[i];
      return { line: number, code: code ?? "" };
    }
  }

  return { line: null, code: "" };
}

export function collect(
  original: string[],
  numbers: (number | null)[],
  saved: string[],
): Question[] {
  const questions: Question[] = [];

  for (const op of opcodes(original, saved)) {
    if (op.tag === "equal" || op.tag === "delete") {
      continue;
    }

    const { line, code } = anchor(original, numbers, op.i1 - 1);

    for (let j = op.j1; j < op.j2; j += 1) {
      const raw = saved[j];
      const text = raw?.trim() ?? "";

      if (text !== "") {
        questions.push({ line, code, text });
      }
    }
  }

  return questions;
}

export function formatQuestions(questions: Question[], path: string): string {
  const out: string[] = [
    `PAIR MODE. The user annotated your proposed change to ${path}.`,
    "The edit was NOT applied. Answer every question below.",
    "Do not re-attempt the edit until the user tells you to.",
    "",
  ];

  for (const question of questions) {
    if (question.line !== null) {
      out.push(`  line ${question.line}: ${question.code}`);
    }

    out.push(`       Q: ${question.text}`);
    out.push("");
  }

  return out.join("\n");
}
