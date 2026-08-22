import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, describe } from "vitest";
import { opcodes, align, fold, mergeChangedPair } from "../src/core/diff";

const casesDir = join(__dirname, "fixtures/cases");
const expectedDir = join(__dirname, "fixtures/expected");

function readLines(path: string): string[] {
  const text = readFileSync(path, "utf-8");
  const lines = text.split("\n");

  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

const caseIds = readdirSync(casesDir).sort();

describe("align + fold against captured fixtures", () => {
  for (const id of caseIds) {
    test(id, () => {
      const before = readLines(join(casesDir, id, "before.txt"));
      const after = readLines(join(casesDir, id, "after.txt"));
      const expected = JSON.parse(readFileSync(join(expectedDir, `${id}.json`), "utf-8")) as {
        left: string[];
        right: string[];
        numbers: (number | null)[];
      };

      const header = expected.left.filter((line) => line.startsWith("#"));

      const rows = align(before, after);
      const panes = fold(rows, header, 5, 4);

      expect(panes.left).toEqual(expected.left);
      expect(panes.right).toEqual(expected.right);
      expect(panes.numbers).toEqual(expected.numbers);
      expect(panes.left.length).toBe(panes.right.length);
      expect(panes.right.length).toBe(panes.numbers.length);
    });
  }
});

test("two-hunks has 39 left rows with exactly 3 fold rows", () => {
  const before = readLines(join(casesDir, "two-hunks", "before.txt"));
  const after = readLines(join(casesDir, "two-hunks", "after.txt"));
  const expected = JSON.parse(
    readFileSync(join(expectedDir, "two-hunks.json"), "utf-8"),
  ) as { left: string[] };
  const header = expected.left.filter((line) => line.startsWith("#"));

  const rows = align(before, after);
  const panes = fold(rows, header, 5, 4);

  expect(panes.left.length).toBe(39);
  const foldRows = panes.left.filter((line) => line.startsWith("⋯ "));
  expect(foldRows.length).toBe(3);
});

test("no-change has zero fold rows", () => {
  const before = readLines(join(casesDir, "no-change", "before.txt"));
  const after = readLines(join(casesDir, "no-change", "after.txt"));
  const expected = JSON.parse(
    readFileSync(join(expectedDir, "no-change.json"), "utf-8"),
  ) as { left: string[] };
  const header = expected.left.filter((line) => line.startsWith("#"));

  const rows = align(before, after);
  const panes = fold(rows, header, 5, 4);

  const foldRows = panes.left.filter((line) => line.startsWith("⋯ "));
  expect(foldRows.length).toBe(0);
});

test("opcodes cover both inputs with no gaps for replace-block", () => {
  const before = readLines(join(casesDir, "replace-block", "before.txt"));
  const after = readLines(join(casesDir, "replace-block", "after.txt"));

  const ops = opcodes(before, after);

  expect(ops[0]?.i1).toBe(0);
  expect(ops[0]?.j1).toBe(0);
  expect(ops[ops.length - 1]?.i2).toBe(before.length);
  expect(ops[ops.length - 1]?.j2).toBe(after.length);

  for (let index = 1; index < ops.length; index += 1) {
    const previous = ops[index - 1];
    const current = ops[index];

    expect(current?.i1).toBe(previous?.i2);
    expect(current?.j1).toBe(previous?.j2);
  }
});

test("mergeChangedPair merges an added-then-removed pair into one replace opcode", () => {
  const added = { added: true, removed: false, value: ["x", "y"], count: 2 };
  const removed = { added: false, removed: true, value: ["a", "b", "c"], count: 3 };

  const opcode = mergeChangedPair(added, removed, 4, 9);

  expect(opcode).toEqual({ tag: "replace", i1: 4, i2: 7, j1: 9, j2: 11 });
});

test("all 8 fixture cases still pass unchanged after the merge fix", () => {
  for (const id of caseIds) {
    const before = readLines(join(casesDir, id, "before.txt"));
    const after = readLines(join(casesDir, id, "after.txt"));
    const expected = JSON.parse(readFileSync(join(expectedDir, `${id}.json`), "utf-8")) as {
      left: string[];
      right: string[];
      numbers: (number | null)[];
    };

    const header = expected.left.filter((line) => line.startsWith("#"));
    const panes = fold(align(before, after), header, 5, 4);

    expect(panes.left).toEqual(expected.left);
    expect(panes.right).toEqual(expected.right);
    expect(panes.numbers).toEqual(expected.numbers);
  }

  expect(caseIds.length).toBe(8);
});

test("a lone removal yields delete and a lone addition yields insert", () => {
  const before = ["a", "b", "c"];
  const after = ["a", "c"];

  const deleteOps = opcodes(before, after);
  expect(deleteOps.some((op) => op.tag === "delete")).toBe(true);
  expect(deleteOps.some((op) => op.tag === "replace")).toBe(false);

  const insertBefore = ["a", "c"];
  const insertAfter = ["a", "b", "c"];

  const insertOps = opcodes(insertBefore, insertAfter);
  expect(insertOps.some((op) => op.tag === "insert")).toBe(true);
  expect(insertOps.some((op) => op.tag === "replace")).toBe(false);
});
