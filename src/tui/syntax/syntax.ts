import { shikiLanguage } from "../../editors/languages";
import { noTokens } from "../paint/paint";
import type { SyntaxToken, TokenProvider } from "../paint/paint.types";
import type { HighlighterLoader, ShikiHighlighter, ShikiToken, SyntaxOptions } from "./syntax.types";
import type { BundledLanguage, BundledTheme } from "shiki";

// Matches the palette in src/tui/paint/theme.ts.
const THEME_ID = "github-dark";

function isBundledLanguage(lang: string, bundled: Record<string, unknown>): lang is BundledLanguage {
  return lang in bundled;
}

function isBundledTheme(id: string, bundled: Record<string, unknown>): id is BundledTheme {
  return id in bundled;
}

const loadShikiHighlighter: HighlighterLoader = async (lang, theme) => {
  const shiki = await import("shiki");

  if (!isBundledLanguage(lang, shiki.bundledLanguages) || !isBundledTheme(theme, shiki.bundledThemes)) {
    throw new Error(`shiki does not bundle language "${lang}" or theme "${theme}"`);
  }

  const highlighter = await shiki.createHighlighter({ langs: [lang], themes: [theme] });

  return {
    codeToTokensBase(code, options) {
      if (!isBundledLanguage(options.lang, shiki.bundledLanguages) || !isBundledTheme(options.theme, shiki.bundledThemes)) {
        return [[]];
      }

      return highlighter.codeToTokensBase(code, { lang: options.lang, theme: options.theme });
    },
  };
};

function hasColor(token: ShikiToken): token is ShikiToken & { color: string } {
  return typeof token.color === "string";
}

function tokenizeLine(highlighter: ShikiHighlighter, lang: string, line: string): SyntaxToken[] {
  const tokenizedLines = highlighter.codeToTokensBase(line, { lang, theme: THEME_ID });
  const lineTokens = tokenizedLines[0] ?? [];

  return lineTokens.filter(hasColor).map((token) => ({
    start: token.offset,
    end: token.offset + token.content.length,
    color: token.color,
  }));
}

export async function createTokenProvider(
  options: SyntaxOptions,
  loadHighlighter: HighlighterLoader = loadShikiHighlighter,
): Promise<TokenProvider> {
  if (!options.enabled) {
    return noTokens;
  }

  const lang = shikiLanguage(options.path);

  if (lang === null) {
    return noTokens;
  }

  let highlighter: ShikiHighlighter;

  try {
    highlighter = await loadHighlighter(lang, THEME_ID);
  } catch {
    return noTokens;
  }

  const cache = new Map<string, SyntaxToken[]>();

  return (line: string): SyntaxToken[] => {
    const cached = cache.get(line);

    if (cached !== undefined) {
      return cached;
    }

    const tokens = tokenizeLine(highlighter, lang, line);
    cache.set(line, tokens);
    return tokens;
  };
}
