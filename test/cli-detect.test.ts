import { test, expect } from "vitest";
import { detectInstalls } from "../src/cli/detect";

test("detectInstalls lists pair among the editors", () => {
  const report = detectInstalls({ resolvesOnPath: () => false, checkPairBundle: () => true });

  expect(report.editors.some((editor) => editor.name === "pair")).toBe(true);
});

test("pair's onPath reflects the bundle checker, not resolvesOnPath", () => {
  const present = detectInstalls({ resolvesOnPath: () => false, checkPairBundle: () => true });
  const missing = detectInstalls({ resolvesOnPath: () => true, checkPairBundle: () => false });

  expect(present.editors.find((editor) => editor.name === "pair")?.onPath).toBe(true);
  expect(missing.editors.find((editor) => editor.name === "pair")?.onPath).toBe(false);
});
