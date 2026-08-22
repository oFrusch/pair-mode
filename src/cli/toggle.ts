import { existsSync } from "node:fs";
import { enable, disable, flagPath } from "../core/state";

export function pairOn(directory: string): string {
  enable(directory);
  return `pair mode ON for ${directory}`;
}

export function pairOff(directory: string): string {
  disable(directory);
  return `pair mode OFF for ${directory}`;
}

export function pairStatus(directory: string): string {
  const on = existsSync(flagPath(directory));
  return `pair mode ${on ? "ON" : "OFF"} for ${directory}`;
}
