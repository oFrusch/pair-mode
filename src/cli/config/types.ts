import type { PairConfig } from "../../core/config";

// A setter returns the updated config, or a string naming what the value should have been.
export type SettingApply = (config: PairConfig, raw: string) => PairConfig | string;

export interface Setting {
  key: string;
  hint: string;
  read(config: PairConfig): string;
  apply: SettingApply;
}

export interface ConfigCommandResult {
  text: string;
  exitCode: number;
}
