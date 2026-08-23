import { diffArrays } from "diff";
import type { ArrayChange } from "diff";
import type { Opcode, Row, Panes } from "./types";
import { MARK_OLD, MARK_NEW, MARK_SAME, FOLD_PREFIX } from "../marks";

export function mergeChangedPair(
  first: ArrayChange<string>,
  second: ArrayChange<string>,
  i: number,
  j: number,
): Opcode {
  const removed = first.removed ? first : second;
  const added = first.added ? first : second;
  const removedCount = removed.value.length;
  const addedCount = added.value.length;

  return { tag: "replace", i1: i, i2: i + removedCount, j1: j, j2: j + addedCount };
}

export function opcodes(before: string[], after: string[]): Opcode[] {
  const chunks = diffArrays(before, after);
  const result: Opcode[] = [];
  let i = 0;
  let j = 0;
  let index = 0;

  while (index < chunks.length) {
    const chunk = chunks[index];

    if (chunk === undefined) {
      break;
    }

    if (!chunk.added && !chunk.removed) {
      const count = chunk.value.length;
      result.push({ tag: "equal", i1: i, i2: i + count, j1: j, j2: j + count });
      i += count;
      j += count;
      index += 1;
      continue;
    }

    const next = chunks[index + 1];
    const nextChanged = next !== undefined && (next.added || next.removed);
    const isPair = nextChanged && next !== undefined && chunk.removed !== next.removed;

    if (isPair && next !== undefined) {
      const opcode = mergeChangedPair(chunk, next, i, j);
      result.push(opcode);
      i = opcode.i2;
      j = opcode.j2;
      index += 2;
      continue;
    }

    if (chunk.removed) {
      const removedCount = chunk.value.length;
      result.push({ tag: "delete", i1: i, i2: i + removedCount, j1: j, j2: j });
      i += removedCount;
      index += 1;
      continue;
    }

    const addedCount = chunk.value.length;
    result.push({ tag: "insert", i1: i, i2: i, j1: j, j2: j + addedCount });
    j += addedCount;
    index += 1;
  }

  return result;
}

export function align(before: string[], after: string[]): Row[] {
  const rows: Row[] = [];
  let current = 0;

  for (const opcode of opcodes(before, after)) {
    const removed = before.slice(opcode.i1, opcode.i2);
    const added = after.slice(opcode.j1, opcode.j2);
    const changed: boolean = opcode.tag !== "equal";
    const rowCount = Math.max(removed.length, added.length);

    for (let row = 0; row < rowCount; row += 1) {
      const removedLine = removed[row];
      const left = removedLine === undefined ? "" : (changed ? MARK_OLD : MARK_SAME) + removedLine;

      const addedLine = added[row];
      let right = "";
      let number: number | null = null;

      if (addedLine !== undefined) {
        current += 1;
        number = current;
        right = (changed ? MARK_NEW : MARK_SAME) + addedLine;
      }

      rows.push({ changed, left, right, number });
    }
  }

  return rows;
}

export function fold(rows: Row[], header: string[], context: number, minFold: number): Panes {
  const keep = Array.from<boolean>({ length: rows.length }).fill(false);

  rows.forEach((row, index) => {
    if (!row.changed) {
      return;
    }

    const start = Math.max(0, index - context);
    const end = Math.min(rows.length, index + context + 1);

    keep.fill(true, start, end);
  });

  if (!keep.some((value) => value)) {
    keep.fill(true);
  }

  const left = [...header];
  const right = [...header];
  const numbers: (number | null)[] = header.map(() => null);
  let index = 0;

  while (index < rows.length) {
    if (keep[index]) {
      const row = rows[index];

      if (row !== undefined) {
        left.push(row.left);
        right.push(row.right);
        numbers.push(row.number);
      }

      index += 1;
      continue;
    }

    const start = index;

    while (index < rows.length && !keep[index]) {
      index += 1;
    }

    const span = index - start;

    if (span < minFold) {
      for (let skipped = start; skipped < index; skipped += 1) {
        const row = rows[skipped];

        if (row !== undefined) {
          left.push(row.left);
          right.push(row.right);
          numbers.push(row.number);
        }
      }

      continue;
    }

    const label = `${FOLD_PREFIX}${span} unchanged lines`;
    left.push(label);
    right.push(label);
    numbers.push(null);
  }

  return { left, right, numbers };
}
