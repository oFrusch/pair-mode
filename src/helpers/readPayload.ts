import { readFileSync } from "node:fs";

export function readPayload(): unknown {
  const text = readFileSync(0, "utf-8");
  return JSON.parse(text);
}
