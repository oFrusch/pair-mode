import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, describe } from "vitest";
import { renderSplit, renderInline } from "../src/core/render";

const casesDir = join(__dirname, "fixtures/cases");
const expectedDir = join(__dirname, "fixtures/expected");

const caseIds = readdirSync(casesDir).sort();

interface Meta {
  tool: string;
  path: string;
}

interface Expected {
  left: string[];
  right: string[];
  numbers: (number | null)[];
}

describe("renderSplit against captured fixtures", () => {
  for (const id of caseIds) {
    test(id, () => {
      const before = readFileSync(join(casesDir, id, "before.txt"), "utf-8");
      const after = readFileSync(join(casesDir, id, "after.txt"), "utf-8");
      const meta = JSON.parse(readFileSync(join(casesDir, id, "meta.json"), "utf-8")) as Meta;
      const expected = JSON.parse(
        readFileSync(join(expectedDir, `${id}.json`), "utf-8"),
      ) as Expected;

      // These fixtures were captured with micro's header hint, so the comparison keeps that line.
      const result = renderSplit({
        before,
        after,
        tool: meta.tool,
        path: meta.path,
        context: 5,
        minFold: 4,
        headerHint: ["# F3 moves between panes. Ctrl+W or F2 sends and closes."],
      });

      expect(result.left).toEqual(expected.left);
      expect(result.right).toEqual(expected.right);
      expect(result.numbers).toEqual(expected.numbers);
    });
  }
});

test("header carries the case tool and path", () => {
  const id = caseIds[0];

  if (id === undefined) {
    throw new Error("no fixture cases found");
  }

  const before = readFileSync(join(casesDir, id, "before.txt"), "utf-8");
  const after = readFileSync(join(casesDir, id, "after.txt"), "utf-8");
  const meta = JSON.parse(readFileSync(join(casesDir, id, "meta.json"), "utf-8")) as Meta;

  const result = renderSplit({
    before,
    after,
    tool: meta.tool,
    path: meta.path,
    context: 5,
    minFold: 4,
    headerHint: [],
  });

  expect(result.left).toContain(`# tool: ${meta.tool}`);
  expect(result.left).toContain(`# file: ${meta.path}`);
});

test("renderInline produces a single array shared between left and right", () => {
  const before = "a\nb\nc\n";
  const after = "a\nx\nc\n";

  const result = renderInline({
    before,
    after,
    tool: "Edit",
    path: "/repo/file.txt",
    context: 5,
    minFold: 4,
    headerHint: [],
  });

  expect(result.left).toBe(result.right);
});

test("an empty before renders every line of after as a changed row", () => {
  const after = "one\ntwo\nthree\n";

  const result = renderInline({
    before: "",
    after,
    tool: "Write",
    path: "/repo/new.txt",
    context: 5,
    minFold: 4,
    headerHint: [],
  });

  const body = result.left.filter((line) => !line.startsWith("#"));

  expect(body).toEqual(["▌▌+ one", "▌▌+ two", "▌▌+ three"]);
});

test("renderSplit's header carries the caller's headerHint lines instead of a hardcoded editor's keys", () => {
  const result = renderSplit({
    before: "a\n",
    after: "b\n",
    tool: "Edit",
    path: "/repo/file.txt",
    context: 5,
    minFold: 4,
    headerHint: ["# Save and quit both windows with :wqa."],
  });

  expect(result.left).toContain("# Save and quit both windows with :wqa.");
  expect(result.left.join("\n")).not.toContain("F3 moves between panes");
});

test("an empty headerHint still renders a clean header with no dangling line", () => {
  const result = renderSplit({
    before: "a\n",
    after: "b\n",
    tool: "Edit",
    path: "/repo/file.txt",
    context: 5,
    minFold: 4,
    headerHint: [],
  });

  expect(result.left).toContain("# tool: Edit");
  expect(result.left.join("\n")).not.toContain("F3 moves between panes");
});
