import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test, expect, describe, beforeEach } from "vitest";
import { bundledLanguages } from "shiki";
import {
  detectLanguage,
  languageIds,
  microSyntaxAssets,
  microSyntaxName,
  vimFiletype,
} from "../src/editors/languages";
import { useIsolatedHome } from "./helpers/env";

const isolated = useIsolatedHome();

const SYNTAX_ASSETS = join(import.meta.dirname, "..", "assets", "syntax");

const PYTHON_SHEBANG = "#!/usr/bin/env python3\nprint('hi')\n";

let workDir: string;

beforeEach(() => {
  workDir = isolated.tempDir("pair-mode-languages-");
});

function writeFixture(name: string, contents: string): string {
  const path = join(workDir, name);
  writeFileSync(path, contents);

  return path;
}

describe("shebang detection", () => {
  test("an extensionless file with a ruby shebang resolves to ruby", () => {
    const path = writeFixture("deploy", "#!/usr/bin/env ruby\nputs 1\n");

    expect(detectLanguage(path)).toBe("ruby");
  });

  test("an extensionless file with a python shebang resolves to python", () => {
    const path = writeFixture("migrate", PYTHON_SHEBANG);

    expect(detectLanguage(path)).toBe("python");
  });

  test("an extensionless file with no shebang resolves to null", () => {
    const path = writeFixture("notes", "just some prose\n");

    expect(detectLanguage(path)).toBeNull();
  });

  test("an unrecognised interpreter resolves to null", () => {
    const path = writeFixture("weird", "#!/usr/bin/env tclsh\n");

    expect(detectLanguage(path)).toBeNull();
  });
});

describe("basename detection", () => {
  test.each([
    ["Gemfile", "ruby"],
    ["Rakefile", "ruby"],
    ["Dockerfile", "docker"],
    ["Makefile", "make"],
  ])("%s resolves to %s without existing on disk", (name, expected) => {
    expect(detectLanguage(join(workDir, name))).toBe(expected);
  });

  test("basename matching ignores case", () => {
    expect(detectLanguage("gemfile")).toBe("ruby");
    expect(detectLanguage("Gemfile")).toBe("ruby");
    expect(detectLanguage("GEMFILE")).toBe("ruby");
  });
});

describe("path shape", () => {
  test("a relative path resolves the same as an absolute one, by extension", () => {
    const absolute = writeFixture("main.go", "package main\n");

    expect(detectLanguage(relative(process.cwd(), absolute))).toBe(detectLanguage(absolute));
    expect(detectLanguage(relative(process.cwd(), absolute))).toBe("go");
  });

  test("a relative path resolves the same as an absolute one, by shebang", () => {
    const absolute = writeFixture("provision", "#!/usr/bin/env ruby\n");

    expect(detectLanguage(relative(process.cwd(), absolute))).toBe("ruby");
  });
});

describe("precedence", () => {
  test("the extension beats the basename and the shebang", () => {
    const path = writeFixture("Dockerfile.rb", PYTHON_SHEBANG);

    expect(detectLanguage(path)).toBe("ruby");
  });

  test("the basename beats the shebang", () => {
    const path = writeFixture("Gemfile", PYTHON_SHEBANG);

    expect(detectLanguage(path)).toBe("ruby");
  });
});

describe("unreadable sources", () => {
  test("a missing file returns null", () => {
    expect(detectLanguage(join(workDir, "does-not-exist"))).toBeNull();
  });

  test("an empty file returns null", () => {
    const path = writeFixture("empty", "");

    expect(detectLanguage(path)).toBeNull();
  });

  test("a directory path returns null", () => {
    const path = join(workDir, "somedir");
    mkdirSync(path);

    expect(detectLanguage(path)).toBeNull();
  });

  // Root ignores the permission bits, so the case cannot be provoked there.
  test.skipIf(process.getuid?.() === 0)("a file with no read permission returns null", () => {
    const path = writeFixture("locked", "#!/usr/bin/env ruby\n");
    chmodSync(path, 0o000);

    expect(detectLanguage(path)).toBeNull();

    chmodSync(path, 0o600);
  });
});

describe("template extensions", () => {
  test(".erb resolves to erb, not html", () => {
    expect(detectLanguage("index.html.erb")).toBe("erb");
  });

  test(".haml resolves to haml", () => {
    expect(detectLanguage("index.haml")).toBe("haml");
  });
});

describe("languageIds", () => {
  test("every id is a language Shiki bundles", () => {
    const bundled = Object.keys(bundledLanguages);
    const unknown = languageIds().filter((id) => !bundled.includes(id));

    expect(unknown).toEqual([]);
  });

  test("the id list is non-empty and free of duplicates", () => {
    const ids = languageIds();

    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("microSyntaxAssets", () => {
  test("every asset name has a shipped YAML file", () => {
    const missing = microSyntaxAssets().filter(
      (name) => !existsSync(join(SYNTAX_ASSETS, `${name}.yaml`)),
    );

    expect(missing).toEqual([]);
  });
});

describe("microSyntaxName", () => {
  test("a language with no shipped asset returns null", () => {
    expect(detectLanguage("main.scss")).toBe("scss");
    expect(microSyntaxName("main.scss")).toBeNull();
  });

  test("an undetectable path returns null", () => {
    expect(microSyntaxName("notes.unknownext")).toBeNull();
  });

  test.each([
    ["a.py", "python3"],
    ["a.sh", "sh"],
    ["Dockerfile", "dockerfile"],
    ["a.rb", "ruby"],
  ])("%s maps to the %s asset", (path, expected) => {
    expect(microSyntaxName(path)).toBe(expected);
  });
});

describe("vimFiletype", () => {
  test.each([
    ["main.go", "go"],
    ["main.py", "python"],
    ["run.sh", "sh"],
    ["a.cs", "cs"],
    ["Dockerfile", "dockerfile"],
  ])("%s maps to the %s filetype", (path, expected) => {
    expect(vimFiletype(path)).toBe(expected);
  });

  test("an undetectable path returns null", () => {
    expect(vimFiletype("notes.unknownext")).toBeNull();
  });
});
