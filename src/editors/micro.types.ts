export interface BandRegion {
  start: string;
  end: string;
}

export type BandRule = Record<string, BandRegion>;

export interface MicroSyntaxSource {
  rules: unknown[];
}

export interface MicroSyntaxFile {
  filetype: string;
  detect: { filename: string };
  rules: unknown[];
}
