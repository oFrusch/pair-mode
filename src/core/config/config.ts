import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type {
  EditorName,
  MultiplexerName,
  Layout,
  Theme,
  Pane,
  PairConfig,
  ConfigError,
  ConfigResult,
} from "./types";
import { DEFAULT_CONTEXT, DEFAULT_MIN_FOLD } from "../marks";
import { isRecord } from "../../helpers/isRecord";

const EDITOR_NAMES: string[] = ["auto", "micro", "nvim", "vim", "nano"];
const MULTIPLEXER_NAMES: string[] = ["auto", "zellij", "tmux", "none"];
const LAYOUTS: string[] = ["split", "inline"];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_CONFIG: PairConfig = {
  editor: "auto",
  multiplexer: "auto",
  layout: "split",
  context: DEFAULT_CONTEXT,
  minFold: DEFAULT_MIN_FOLD,
  pane: { width: "90%", height: "90%" },
  theme: { add: "#1e3a1e", del: "#3a1e1e", fold: "#2a2a2a" },
  trace: false,
  autoApprove: true,
};

// homeDir lets a caller (setup, in particular) resolve the config path for an explicit home rather than the process's real one.
export function configPath(homeDir?: string): string {
  const base = process.env["XDG_CONFIG_HOME"] || join(homeDir ?? homedir(), ".config");
  return join(base, "pair-mode", "config.json");
}

function isEditorName(value: unknown): value is EditorName {
  return typeof value === "string" && EDITOR_NAMES.includes(value);
}

function isEditorList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string")
  );
}

function isMultiplexerName(value: unknown): value is MultiplexerName {
  return typeof value === "string" && MULTIPLEXER_NAMES.includes(value);
}

function isLayout(value: unknown): value is Layout {
  return typeof value === "string" && LAYOUTS.includes(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validateEditor(
  raw: Record<string, unknown>,
  errors: ConfigError[],
): EditorName | string[] {
  if (!("editor" in raw)) {
    return DEFAULT_CONFIG.editor;
  }

  const value = raw["editor"];

  if (isEditorName(value)) {
    return value;
  }

  if (isEditorList(value)) {
    return value;
  }

  errors.push({
    path: "editor",
    message: "must be one of auto, micro, nvim, vim, nano, or a non-empty array of strings",
  });
  return DEFAULT_CONFIG.editor;
}

function validateMultiplexer(raw: Record<string, unknown>, errors: ConfigError[]): MultiplexerName {
  if (!("multiplexer" in raw)) {
    return DEFAULT_CONFIG.multiplexer;
  }

  const value = raw["multiplexer"];

  if (isMultiplexerName(value)) {
    return value;
  }

  errors.push({ path: "multiplexer", message: "must be one of auto, zellij, tmux, none" });
  return DEFAULT_CONFIG.multiplexer;
}

function validateLayout(raw: Record<string, unknown>, errors: ConfigError[]): Layout {
  if (!("layout" in raw)) {
    return DEFAULT_CONFIG.layout;
  }

  const value = raw["layout"];

  if (isLayout(value)) {
    return value;
  }

  errors.push({ path: "layout", message: "must be one of split, inline" });
  return DEFAULT_CONFIG.layout;
}

function validatePositiveInteger(
  raw: Record<string, unknown>,
  field: "context" | "minFold",
  fallback: number,
  errors: ConfigError[],
): number {
  if (!(field in raw)) {
    return fallback;
  }

  const value = raw[field];

  if (isPositiveInteger(value)) {
    return value;
  }

  errors.push({ path: field, message: "must be an integer of 1 or more" });
  return fallback;
}

function validatePane(raw: Record<string, unknown>, errors: ConfigError[]): Pane {
  if (!("pane" in raw)) {
    return DEFAULT_CONFIG.pane;
  }

  const value = raw["pane"];

  if (!isRecord(value)) {
    errors.push({ path: "pane", message: "must be an object" });
    return DEFAULT_CONFIG.pane;
  }

  let width: string | null = DEFAULT_CONFIG.pane.width;

  if ("width" in value) {
    width = typeof value["width"] === "string" ? value["width"] : null;

    if (width === null) {
      errors.push({ path: "pane.width", message: "must be a string" });
    }
  }

  let height: string | null = DEFAULT_CONFIG.pane.height;

  if ("height" in value) {
    height = typeof value["height"] === "string" ? value["height"] : null;

    if (height === null) {
      errors.push({ path: "pane.height", message: "must be a string" });
    }
  }

  return {
    width: width ?? DEFAULT_CONFIG.pane.width,
    height: height ?? DEFAULT_CONFIG.pane.height,
  };
}

function validateThemeField(
  raw: Record<string, unknown>,
  field: "add" | "del" | "fold",
  errors: ConfigError[],
): string {
  if (!(field in raw)) {
    return DEFAULT_CONFIG.theme[field];
  }

  const value = raw[field];

  if (isHexColor(value)) {
    return value;
  }

  errors.push({ path: `theme.${field}`, message: "must be a 6-digit hex colour" });
  return DEFAULT_CONFIG.theme[field];
}

function validateTheme(raw: Record<string, unknown>, errors: ConfigError[]): Theme {
  if (!("theme" in raw)) {
    return DEFAULT_CONFIG.theme;
  }

  const value = raw["theme"];

  if (!isRecord(value)) {
    errors.push({ path: "theme", message: "must be an object" });
    return DEFAULT_CONFIG.theme;
  }

  return {
    add: validateThemeField(value, "add", errors),
    del: validateThemeField(value, "del", errors),
    fold: validateThemeField(value, "fold", errors),
  };
}

function validateTrace(raw: Record<string, unknown>, errors: ConfigError[]): boolean {
  if (!("trace" in raw)) {
    return DEFAULT_CONFIG.trace;
  }

  const value = raw["trace"];

  if (typeof value === "boolean") {
    return value;
  }

  errors.push({ path: "trace", message: "must be a boolean" });
  return DEFAULT_CONFIG.trace;
}

function validateAutoApprove(raw: Record<string, unknown>, errors: ConfigError[]): boolean {
  if (!("autoApprove" in raw)) {
    return DEFAULT_CONFIG.autoApprove;
  }

  const value = raw["autoApprove"];

  if (typeof value === "boolean") {
    return value;
  }

  errors.push({ path: "autoApprove", message: "must be a boolean" });
  return DEFAULT_CONFIG.autoApprove;
}

function validate(raw: Record<string, unknown>): ConfigResult {
  const errors: ConfigError[] = [];

  const config: PairConfig = {
    editor: validateEditor(raw, errors),
    multiplexer: validateMultiplexer(raw, errors),
    layout: validateLayout(raw, errors),
    context: validatePositiveInteger(raw, "context", DEFAULT_CONFIG.context, errors),
    minFold: validatePositiveInteger(raw, "minFold", DEFAULT_CONFIG.minFold, errors),
    pane: validatePane(raw, errors),
    theme: validateTheme(raw, errors),
    trace: validateTrace(raw, errors),
    autoApprove: validateAutoApprove(raw, errors),
  };

  return { config, errors };
}

export function loadConfig(path?: string): ConfigResult {
  const target = path ?? configPath();

  if (!existsSync(target)) {
    return { config: DEFAULT_CONFIG, errors: [] };
  }

  let text: string;

  try {
    text = readFileSync(target, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      config: DEFAULT_CONFIG,
      errors: [{ path: target, message: `could not read file: ${message}` }],
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      config: DEFAULT_CONFIG,
      errors: [{ path: target, message: `invalid JSON: ${message}` }],
    };
  }

  if (!isRecord(parsed)) {
    return {
      config: DEFAULT_CONFIG,
      errors: [{ path: target, message: "config must be a JSON object" }],
    };
  }

  return validate(parsed);
}

export function saveConfig(config: PairConfig, path?: string): void {
  const target = path ?? configPath();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
