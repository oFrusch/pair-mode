export interface RenderInput {
  before: string;
  after: string;
  tool: string;
  path: string;
  context: number;
  minFold: number;
  headerHint: string[];
}

export interface RenderResult {
  left: string[];
  right: string[];
  numbers: (number | null)[];
}
