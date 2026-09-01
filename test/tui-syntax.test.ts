import { test, expect, describe, vi } from "vitest";
import { shikiLanguage, knownExtensions } from "../src/editors/languages";
import { createTokenProvider, MAX_CACHED_LINES } from "../src/tui/syntax";
import type { HighlighterLoader, ShikiHighlighter } from "../src/tui/syntax";

function fakeHighlighter(colorByContent: Record<string, string>): ShikiHighlighter {
  return {
    codeToTokensBase(code) {
      if (code === "") {
        return [[]];
      }

      const content = code;
      const color = colorByContent[content] ?? "#ffffff";
      return [[{ content, offset: 0, color }]];
    },
  };
}

describe("shikiLanguage", () => {
  test(".py returns python, not micro's python3", () => {
    expect(shikiLanguage("script.py")).toBe("python");
  });

  test(".sh returns shellscript and .zsh returns zsh", () => {
    expect(shikiLanguage("run.sh")).toBe("shellscript");
    expect(shikiLanguage("run.zsh")).toBe("zsh");
  });

  test(".dockerfile returns docker", () => {
    expect(shikiLanguage("build.dockerfile")).toBe("docker");
  });

  test(".ts returns typescript", () => {
    expect(shikiLanguage("main.ts")).toBe("typescript");
  });

  test("an unknown extension returns null", () => {
    expect(shikiLanguage("notes.unknownext")).toBeNull();
  });

  test("every known extension translates to a Shiki id", () => {
    for (const ext of knownExtensions()) {
      expect(shikiLanguage(`file${ext}`)).not.toBeNull();
    }
  });
});

describe("createTokenProvider", () => {
  test("enabled: false returns a provider yielding [], and the loader never runs", async () => {
    const loader = vi.fn<HighlighterLoader>();

    const provider = await createTokenProvider(
      { path: "main.ts", enabled: false, truecolor: true },
      loader,
    );

    expect(provider("const x = 1;", 1)).toEqual([]);
    expect(loader).not.toHaveBeenCalled();
  });

  test("an unknown extension returns a provider yielding [], and the loader never runs", async () => {
    const loader = vi.fn<HighlighterLoader>();

    const provider = await createTokenProvider(
      { path: "notes.unknownext", enabled: true, truecolor: true },
      loader,
    );

    expect(provider("anything", 1)).toEqual([]);
    expect(loader).not.toHaveBeenCalled();
  });

  test("a loader that throws returns a provider yielding [] and does not reject", async () => {
    const loader: HighlighterLoader = async () => {
      throw new Error("shiki failed to load");
    };

    const provider = await createTokenProvider(
      { path: "main.ts", enabled: true, truecolor: true },
      loader,
    );

    expect(provider("const x = 1;", 1)).toEqual([]);
  });

  test("a working fake loader produces tokens matching what the fake reported", async () => {
    const highlighter = fakeHighlighter({ "const x = 1;": "#79c0ff" });
    const loader: HighlighterLoader = async () => highlighter;

    const provider = await createTokenProvider(
      { path: "main.ts", enabled: true, truecolor: true },
      loader,
    );

    expect(provider("const x = 1;", 1)).toEqual([{ start: 0, end: 12, color: "#79c0ff" }]);
  });

  test("the same line tokenized twice calls the fake highlighter once", async () => {
    const codeToTokensBase = vi.fn(fakeHighlighter({}).codeToTokensBase);
    const loader: HighlighterLoader = async () => ({ codeToTokensBase });

    const provider = await createTokenProvider(
      { path: "main.ts", enabled: true, truecolor: true },
      loader,
    );

    provider("const x = 1;", 1);
    provider("const x = 1;", 1);

    expect(codeToTokensBase).toHaveBeenCalledTimes(1);
  });

  test("two different lines call the fake highlighter twice", async () => {
    const codeToTokensBase = vi.fn(fakeHighlighter({}).codeToTokensBase);
    const loader: HighlighterLoader = async () => ({ codeToTokensBase });

    const provider = await createTokenProvider(
      { path: "main.ts", enabled: true, truecolor: true },
      loader,
    );

    provider("const x = 1;", 1);
    provider("const x = 2;", 2);

    expect(codeToTokensBase).toHaveBeenCalledTimes(2);
  });

  test("an empty line returns []", async () => {
    const loader: HighlighterLoader = async () => fakeHighlighter({});

    const provider = await createTokenProvider(
      { path: "main.ts", enabled: true, truecolor: true },
      loader,
    );

    expect(provider("", 1)).toEqual([]);
  });
});

describe("createTokenProvider memoization", () => {
  test("two calls for the same language share one provider instance", async () => {
    const first = await createTokenProvider({ path: "main.ts", enabled: true, truecolor: true });
    const second = await createTokenProvider({ path: "other.ts", enabled: true, truecolor: true });

    expect(second).toBe(first);
  });

  test("a different language gets its own provider instance", async () => {
    const typescript = await createTokenProvider({
      path: "main.ts",
      enabled: true,
      truecolor: true,
    });

    const python = await createTokenProvider({
      path: "main.py",
      enabled: true,
      truecolor: true,
    });

    expect(python).not.toBe(typescript);
  });

  test("the shared provider still tokenizes after being reused", async () => {
    await createTokenProvider({ path: "main.ts", enabled: true, truecolor: true });
    const again = await createTokenProvider({ path: "main.ts", enabled: true, truecolor: true });

    expect(again("const x = 1;", 1).length).toBeGreaterThan(0);
  });

  test("an injected loader is never shared, so each call builds its own provider", async () => {
    const loader = vi.fn<HighlighterLoader>(async () => fakeHighlighter({}));

    await createTokenProvider({ path: "main.ts", enabled: true, truecolor: true }, loader);
    await createTokenProvider({ path: "main.ts", enabled: true, truecolor: true }, loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe("the bounded line cache", () => {
  test("the newest line stays cached once the bound is reached", async () => {
    const codeToTokensBase = vi.fn(fakeHighlighter({}).codeToTokensBase);
    const loader: HighlighterLoader = async () => ({ codeToTokensBase });

    const provider = await createTokenProvider(
      { path: "main.ts", enabled: true, truecolor: true },
      loader,
    );

    for (let index = 0; index < MAX_CACHED_LINES; index += 1) {
      provider(`line ${index}`, index);
    }

    codeToTokensBase.mockClear();
    provider(`line ${MAX_CACHED_LINES - 1}`, MAX_CACHED_LINES - 1);

    expect(codeToTokensBase).not.toHaveBeenCalled();
  });

  test("the oldest line is evicted once the bound is exceeded", async () => {
    const codeToTokensBase = vi.fn(fakeHighlighter({}).codeToTokensBase);
    const loader: HighlighterLoader = async () => ({ codeToTokensBase });

    const provider = await createTokenProvider(
      { path: "main.ts", enabled: true, truecolor: true },
      loader,
    );

    for (let index = 0; index < MAX_CACHED_LINES; index += 1) {
      provider(`line ${index}`, index);
    }

    provider("one line too many", MAX_CACHED_LINES);
    codeToTokensBase.mockClear();
    provider("line 0", 0);

    expect(codeToTokensBase).toHaveBeenCalledTimes(1);
  });
});
