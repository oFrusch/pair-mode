import { loadConfig, saveConfig, configPath } from "../../core/config";
import type {
  EditorName,
  Layout,
  MultiplexerName,
  NotePosition,
  PairConfig,
  TransportName,
} from "../../core/config";
import { isHexColor } from "../../helpers/hexColor";
import type { ConfigCommandResult, Setting } from "./types";

const MAX_PORT = 65535;

const EDITORS: EditorName[] = ["auto", "pair", "micro", "nvim", "vim", "nano"];
const MULTIPLEXERS: MultiplexerName[] = ["auto", "zellij", "tmux", "none"];
const TRANSPORTS: TransportName[] = ["pane", "session"];
const LAYOUTS: Layout[] = ["split", "inline"];
const NOTE_POSITIONS: NotePosition[] = ["panel", "anchored"];

function parseBoolean(raw: string): boolean | null {
  if (raw === "true") {
    return true;
  }

  return raw === "false" ? false : null;
}

function parseInteger(raw: string, low: number, high: number): number | null {
  const value = Number(raw);
  const valid = Number.isInteger(value) && value >= low && value <= high;
  return valid ? value : null;
}

// A string array reaches the editor field as a raw command, so a space separates its words.
function parseEditor(raw: string): string | string[] {
  const words = raw
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  return words.length > 1 ? words : raw;
}

function describeEditor(config: PairConfig): string {
  return Array.isArray(config.editor) ? config.editor.join(" ") : config.editor;
}

function oneOf(names: readonly string[]): string {
  return `one of ${names.join(", ")}`;
}

function booleanSetting(
  key: string,
  read: (config: PairConfig) => boolean,
  write: (config: PairConfig, value: boolean) => PairConfig,
): Setting {
  return {
    key,
    hint: "true or false",
    read: (config) => String(read(config)),
    apply: (config, raw) => {
      const value = parseBoolean(raw);
      return value === null ? "true or false" : write(config, value);
    },
  };
}

function integerSetting(
  key: string,
  low: number,
  high: number,
  read: (config: PairConfig) => number,
  write: (config: PairConfig, value: number) => PairConfig,
): Setting {
  return {
    key,
    hint: `an integer from ${low} to ${high}`,
    read: (config) => String(read(config)),
    apply: (config, raw) => {
      const value = parseInteger(raw, low, high);
      return value === null ? `an integer from ${low} to ${high}` : write(config, value);
    },
  };
}

// find narrows to the union member, so no call site needs a cast to write the value back.
function enumSetting<T extends string>(
  key: string,
  names: T[],
  read: (config: PairConfig) => string,
  write: (config: PairConfig, value: T) => PairConfig,
): Setting {
  return {
    key,
    hint: oneOf(names),
    read,
    apply: (config, raw) => {
      const match = names.find((name) => name === raw);
      return match === undefined ? oneOf(names) : write(config, match);
    },
  };
}

function hexSetting(
  key: string,
  read: (config: PairConfig) => string,
  write: (config: PairConfig, value: string) => PairConfig,
): Setting {
  return {
    key,
    hint: "a 6-digit hex colour",
    read,
    apply: (config, raw) =>
      isHexColor(raw) ? write(config, raw) : "a 6-digit hex colour such as #1e3a1e",
  };
}

function textSetting(
  key: string,
  hint: string,
  read: (config: PairConfig) => string,
  write: (config: PairConfig, value: string) => PairConfig,
): Setting {
  return { key, hint, read, apply: (config, raw) => write(config, raw) };
}

// Each entry names one settable field, so the help text and the validator never drift apart.
export const SETTINGS: Setting[] = [
  {
    key: "editor",
    hint: `${oneOf(EDITORS)}, or a command`,
    read: describeEditor,
    apply: (config, raw) => {
      const value = parseEditor(raw);

      if (Array.isArray(value)) {
        return { ...config, editor: value };
      }

      const known = EDITORS.find((name) => name === value);

      return known === undefined
        ? `${oneOf(EDITORS)}, or a command such as "code --wait"`
        : { ...config, editor: known };
    },
  },
  enumSetting(
    "multiplexer",
    MULTIPLEXERS,
    (config) => config.multiplexer,
    (config, value) => ({ ...config, multiplexer: value }),
  ),
  enumSetting(
    "transport",
    TRANSPORTS,
    (config) => config.transport,
    (config, value) => ({ ...config, transport: value }),
  ),
  enumSetting(
    "layout",
    LAYOUTS,
    (config) => config.layout,
    (config, value) => ({ ...config, layout: value }),
  ),
  enumSetting(
    "notes",
    NOTE_POSITIONS,
    (config) => config.notes,
    (config, value) => ({ ...config, notes: value }),
  ),
  integerSetting(
    "context",
    1,
    Number.MAX_SAFE_INTEGER,
    (config) => config.context,
    (config, value) => ({ ...config, context: value }),
  ),
  integerSetting(
    "minFold",
    1,
    Number.MAX_SAFE_INTEGER,
    (config) => config.minFold,
    (config, value) => ({ ...config, minFold: value }),
  ),
  textSetting(
    "pane.width",
    'a size such as "95%"',
    (config) => config.pane.width,
    (config, value) => ({ ...config, pane: { ...config.pane, width: value } }),
  ),
  textSetting(
    "pane.height",
    'a size such as "95%"',
    (config) => config.pane.height,
    (config, value) => ({ ...config, pane: { ...config.pane, height: value } }),
  ),
  integerSetting(
    "session.timeout",
    1,
    Number.MAX_SAFE_INTEGER,
    (config) => config.session.timeout,
    (config, value) => ({ ...config, session: { timeout: value } }),
  ),
  booleanSetting(
    "web.enabled",
    (config) => config.web.enabled,
    (config, value) => ({ ...config, web: { ...config.web, enabled: value } }),
  ),
  integerSetting(
    "web.port",
    0,
    MAX_PORT,
    (config) => config.web.port,
    (config, value) => ({ ...config, web: { ...config.web, port: value } }),
  ),
  hexSetting(
    "theme.add",
    (config) => config.theme.add,
    (config, value) => ({ ...config, theme: { ...config.theme, add: value } }),
  ),
  hexSetting(
    "theme.del",
    (config) => config.theme.del,
    (config, value) => ({ ...config, theme: { ...config.theme, del: value } }),
  ),
  hexSetting(
    "theme.fold",
    (config) => config.theme.fold,
    (config, value) => ({ ...config, theme: { ...config.theme, fold: value } }),
  ),
  booleanSetting(
    "theme.rowBand",
    (config) => config.theme.rowBand,
    (config, value) => ({ ...config, theme: { ...config.theme, rowBand: value } }),
  ),
  booleanSetting(
    "syntax",
    (config) => config.syntax,
    (config, value) => ({ ...config, syntax: value }),
  ),
  booleanSetting(
    "trace",
    (config) => config.trace,
    (config, value) => ({ ...config, trace: value }),
  ),
  booleanSetting(
    "autoApprove",
    (config) => config.autoApprove,
    (config, value) => ({ ...config, autoApprove: value }),
  ),
];

function widestKey(): number {
  return SETTINGS.reduce((widest, setting) => Math.max(widest, setting.key.length), 0);
}

function listAll(config: PairConfig, path: string): string {
  const width = widestKey();
  const rows = SETTINGS.map((setting) => `  ${setting.key.padEnd(width)}  ${setting.read(config)}`);

  return [path, "", ...rows].join("\n");
}

function findSetting(key: string): Setting | null {
  return SETTINGS.find((setting) => setting.key === key) ?? null;
}

function unknownKey(key: string): string {
  const known = SETTINGS.map((setting) => setting.key).join(", ");
  return `unknown key "${key}". Known keys: ${known}`;
}

export function runConfig(args: string[], path?: string): ConfigCommandResult {
  const target = path ?? configPath();
  const current = loadConfig(target).config;
  const [key, ...rest] = args;

  if (key === undefined) {
    return { text: listAll(current, target), exitCode: 0 };
  }

  const setting = findSetting(key);

  if (setting === null) {
    return { text: unknownKey(key), exitCode: 1 };
  }

  if (rest.length === 0) {
    return { text: setting.read(current), exitCode: 0 };
  }

  const updated = setting.apply(current, rest.join(" "));

  if (typeof updated === "string") {
    return { text: `${key} must be ${updated}`, exitCode: 1 };
  }

  saveConfig(updated, target);

  return { text: `${key} = ${setting.read(updated)}`, exitCode: 0 };
}
