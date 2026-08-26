// The client runs without the DOM lib, so it names the small surface it borrows from a Range.
export interface RangeLike {
  selectNodeContents(node: unknown): void;
  setEnd(node: unknown, offset: number): void;
  toString(): string;
}

export interface CellRef {
  row: string | undefined;
  pane: string | undefined;
}
