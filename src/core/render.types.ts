export interface RenderInput {
  before: string;
  after: string;
  tool: string;
  path: string;
  context: number;
  minFold: number;
}

export interface RenderResult {
  left: string[];
  right: string[];
  numbers: (number | null)[];
}
