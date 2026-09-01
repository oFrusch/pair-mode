// The canonical language id is the Shiki id, because Shiki carries the largest namespace.
export type LanguageId = string;

export interface ShebangRule {
  pattern: RegExp;
  id: LanguageId;
}
