import { shikiLanguage } from "../../editors/languages";
import { noTokens } from "../paint/paint";
import type { SyntaxToken, TokenProvider } from "../paint/paint.types";
import type {
  HighlighterLoader,
  ShikiHighlighter,
  ShikiToken,
  SyntaxOptions,
} from "./syntax.types";
import type { BundledLanguage, BundledTheme } from "shiki";

// Matches the palette in src/tui/paint/theme.ts.
const THEME_ID = "github-dark";

// Roughly ten full reviews of hot lines per language, which caps the shared cache near a megabyte.
export const MAX_CACHED_LINES = 4096;

// A watcher runs many reviews in one process, so shiki is built once per language and never again.
const providers = new Map<string, Promise<TokenProvider>>();

function isBundledLanguage(
  lang: string,
  bundled: Record<string, unknown>,
): lang is BundledLanguage {
  return lang in bundled;
}

function isBundledTheme(id: string, bundled: Record<string, unknown>): id is BundledTheme {
  return id in bundled;
}

const loadShikiHighlighter: HighlighterLoader = async (lang, theme) => {
  const shiki = await import("shiki");

  if (
    !isBundledLanguage(lang, shiki.bundledLanguages) ||
    !isBundledTheme(theme, shiki.bundledThemes)
  ) {
    throw new Error(`shiki does not bundle language "${lang}" or theme "${theme}"`);
  }

  const highlighter = await shiki.createHighlighter({ langs: [lang], themes: [theme] });

  return {
    codeToTokensBase(code, options) {
      if (
        !isBundledLanguage(options.lang, shiki.bundledLanguages) ||
        !isBundledTheme(options.theme, shiki.bundledThemes)
      ) {
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

async function tryLoadHighlighter(
  load: HighlighterLoader,
  lang: string,
  theme: string,
): Promise<ShikiHighlighter | null> {
  try {
    return await load(lang, theme);
  } catch {
    return null;
  }
}

// The line cache now outlives one review, so it evicts in insertion order rather than growing forever.
function remember(cache: Map<string, SyntaxToken[]>, line: string, tokens: SyntaxToken[]): void {
  if (cache.size >= MAX_CACHED_LINES) {
    const oldest = cache.keys().next();

    if (oldest.done !== true) {
      cache.delete(oldest.value);
    }
  }

  cache.set(line, tokens);
}

async function buildTokenProvider(load: HighlighterLoader, lang: string): Promise<TokenProvider> {
  const highlighter = await tryLoadHighlighter(load, lang, THEME_ID);

  if (highlighter === null) {
    return noTokens;
  }

  const cache = new Map<string, SyntaxToken[]>();

  return (line: string): SyntaxToken[] => {
    const cached = cache.get(line);

    if (cached !== undefined) {
      return cached;
    }

    const tokens = tokenizeLine(highlighter, lang, line);
    remember(cache, line, tokens);

    return tokens;
  };
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

  // An injected loader is a caller-owned test seam, so only the real shiki highlighter is shared process-wide.
  if (loadHighlighter !== loadShikiHighlighter) {
    return buildTokenProvider(loadHighlighter, lang);
  }

  const shared = providers.get(lang);

  if (shared !== undefined) {
    return shared;
  }

  const created = buildTokenProvider(loadHighlighter, lang);
  providers.set(lang, created);

  return created;
}
