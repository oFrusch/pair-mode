import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { test, expect } from "vitest";
import { syntaxText } from "../src/editors/micro";
import { syntaxSource } from "../src/editors/syntax-cache";

const assetsDir = join(import.meta.dirname, "..", "assets", "syntax");
const languages = readdirSync(assetsDir)
  .filter((name) => name.endsWith(".yaml"))
  .map((name) => name.replace(/\.yaml$/, ""));

test("every vendored language has an asset file", () => {
  expect(languages.length).toBeGreaterThan(0);
});

test.each(languages)("generated syntax file for %s parses as YAML", (lang) => {
  const source = syntaxSource(lang, assetsDir);

  expect(source).not.toBeNull();

  if (source === null) {
    return;
  }

  const text = syntaxText(lang, source);

  expect(text).not.toBeNull();

  if (text === null) {
    return;
  }

  const parsed = parse(text);
  const upstream = parse(source);

  expect(parsed.rules).toBeInstanceOf(Array);

  const bandRules = parsed.rules.slice(-4);
  const names = bandRules.map((rule: Record<string, unknown>) => Object.keys(rule)[0]);

  expect(names).toEqual(["pairadd", "pairdel", "pairskip", "comment"]);

  for (const rule of bandRules) {
    const body = Object.values(rule)[0] as Record<string, unknown>;

    expect(body).toHaveProperty("start");
    expect(body).toHaveProperty("end");
  }

  const pairadd = bandRules[0].pairadd;

  expect(pairadd.start).toBe("^▌▌\\+");
  expect(parsed.detect.filename).toBe(`\\.pair-${lang}$`);

  const upstreamRuleCount = upstream.rules.length;

  expect(parsed.rules.length).toBe(upstreamRuleCount + 4);
  expect(parsed.rules.slice(0, upstreamRuleCount)).toEqual(upstream.rules);
});
