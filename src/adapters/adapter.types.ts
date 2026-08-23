export interface SimulateCall {
  tool: string;
  input: Record<string, unknown>;
  filePath: string;
}
