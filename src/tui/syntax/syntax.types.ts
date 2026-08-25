export interface SyntaxOptions {
  path: string;
  enabled: boolean;
  truecolor: boolean;
}

export interface ShikiToken {
  content: string;
  offset: number;
  color?: string;
}

export interface ShikiHighlighter {
  codeToTokensBase(code: string, options: { lang: string; theme: string }): ShikiToken[][];
}

export type HighlighterLoader = (lang: string, theme: string) => Promise<ShikiHighlighter>;
