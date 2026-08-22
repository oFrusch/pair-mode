import { test, expect } from "vitest";
import { applyEdit, simulate } from "../src/core/simulate";

test("applyEdit returns null for an absent old_string", () => {
  const result = applyEdit("hello world", { old_string: "missing", new_string: "x" });

  expect(result).toBeNull();
});

test("applyEdit replaces only the first occurrence by default", () => {
  const result = applyEdit("a a a", { old_string: "a", new_string: "b" });

  expect(result).toBe("b a a");
});

test("applyEdit honours replace_all", () => {
  const result = applyEdit("a a a", { old_string: "a", new_string: "b", replace_all: true });

  expect(result).toBe("b b b");
});

test("applyEdit with an empty old_string and replace_all matches Python's str.replace(\"\", x)", () => {
  const result = applyEdit("abc", { old_string: "", new_string: "X", replace_all: true });

  expect(result).toBe("XaXbXcX");
});

function readFile(files: Record<string, string>): (path: string) => string {
  return (path: string) => files[path] ?? "";
}

test("simulate handles Write", () => {
  const readFn = readFile({ "/tmp/a.txt": "old text" });
  const request = simulate("Write", { file_path: "/tmp/a.txt", content: "new text" }, readFn);

  expect(request).toEqual({ tool: "Write", filePath: "/tmp/a.txt", before: "old text", after: "new text" });
});

test("simulate handles Edit with a single old_string/new_string pair", () => {
  const readFn = readFile({ "/tmp/a.txt": "hello world" });
  const request = simulate(
    "Edit",
    { file_path: "/tmp/a.txt", old_string: "world", new_string: "there" },
    readFn,
  );

  expect(request).toEqual({ tool: "Edit", filePath: "/tmp/a.txt", before: "hello world", after: "hello there" });
});

test("simulate handles MultiEdit applying edits in order", () => {
  const readFn = readFile({ "/tmp/a.txt": "one two three" });
  const request = simulate(
    "MultiEdit",
    {
      file_path: "/tmp/a.txt",
      edits: [
        { old_string: "one", new_string: "1" },
        { old_string: "two", new_string: "2" },
      ],
    },
    readFn,
  );

  expect(request).toEqual({ tool: "MultiEdit", filePath: "/tmp/a.txt", before: "one two three", after: "1 2 three" });
});

test("simulate returns null for Bash", () => {
  const readFn = readFile({});
  const request = simulate("Bash", { command: "ls" }, readFn);

  expect(request).toBeNull();
});

test("simulate returns null for a missing file_path", () => {
  const readFn = readFile({});
  const request = simulate("Write", { content: "x" }, readFn);

  expect(request).toBeNull();
});

test("simulate returns null when an Edit's old_string is not found", () => {
  const readFn = readFile({ "/tmp/a.txt": "hello world" });
  const request = simulate(
    "Edit",
    { file_path: "/tmp/a.txt", old_string: "missing", new_string: "x" },
    readFn,
  );

  expect(request).toBeNull();
});
