import { existsSync, openSync, closeSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, configPath } from "../../core/config";
import type { ConfigResult, PairConfig } from "../../core/config";
import { stateDir, sessionSocketPath } from "../../core/state";
import { probeSocket } from "../../transports/session";
import { resolve as resolveEditor } from "../../editors/index";
import { detect as detectMultiplexer } from "../../multiplexers/index";
import { installRoot } from "../install-root";
import {
  claudeCodeSettingsPath,
  codexHooksPath,
  isPairCommandRegistered,
  isPreToolUseRegistered,
  isReExportRegistered,
  opencodePluginPath,
  pairCommandPath,
  piExtensionPath,
} from "../register";
import type { CliName } from "../register";
import type { DoctorCheck, DoctorOptions, DoctorReport } from "./types";

function checkConfig(result: ConfigResult): DoctorCheck {
  const path = configPath();

  if (result.errors.length === 0) {
    return { name: `config: ${path}`, passed: true, detail: "parses cleanly" };
  }

  const detail = result.errors.map((error) => `${error.path}: ${error.message}`).join("; ");
  return { name: `config: ${path}`, passed: false, detail };
}

function checkEditor(
  config: PairConfig,
  resolvesOnPath: DoctorOptions["resolvesOnPath"],
): DoctorCheck {
  const editor = resolveEditor(config.editor, resolvesOnPath);
  const available = editor.available();

  return {
    name: `editor: ${editor.name}`,
    passed: available,
    detail: available ? "binary present" : "binary not found on PATH",
  };
}

function checkMultiplexer(
  config: PairConfig,
  adapters: DoctorOptions["multiplexerAdapters"],
): DoctorCheck {
  const multiplexer = detectMultiplexer(config.multiplexer, adapters);
  const inside = multiplexer.available();

  return {
    name: `multiplexer: ${multiplexer.name}`,
    passed: inside,
    detail: inside ? "current shell is inside it" : "current shell is not inside it",
  };
}

function checkControllingTerminal(openTty: () => number): DoctorCheck {
  try {
    const fd = openTty();
    closeSync(fd);
    return { name: "controlling terminal", passed: true, detail: "/dev/tty opened" };
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    const message = error instanceof Error ? error.message : String(error);
    return { name: "controlling terminal", passed: false, detail: `${name}: ${message}` };
  }
}

const COMMAND_CLIS: CliName[] = ["claude-code", "codex", "opencode", "pi"];

function describeCommand(cli: CliName, home: string): DoctorCheck {
  const path = pairCommandPath(home, cli);
  const present = isPairCommandRegistered(path);

  return {
    name: `${cli} /pair command`,
    passed: present,
    detail: present ? `installed at ${path}` : "not installed; run pair-mode setup",
    warnOnly: true,
  };
}

interface RegistrationSpec {
  cli: string;
  registered: boolean;
  targetExists: boolean;
}

function describeRegistration(spec: RegistrationSpec): DoctorCheck {
  if (!spec.registered) {
    return { name: `${spec.cli} hook`, passed: false, detail: "not registered" };
  }

  return {
    name: `${spec.cli} hook`,
    passed: spec.targetExists,
    detail: spec.targetExists
      ? "registered, target exists"
      : "registered, but target file is missing",
  };
}

function checkClis(home: string, root: string): DoctorCheck[] {
  const claudeCommand = join(root, "dist", "claude-code.js");
  const claudeRegistered = isPreToolUseRegistered(claudeCodeSettingsPath(home), claudeCommand);

  const codexCommand = join(root, "dist", "codex.js");
  const codexRegistered = isPreToolUseRegistered(codexHooksPath(home), codexCommand);

  const opencodeTarget = join(root, "dist", "opencode.js");
  const opencodeRegistered = isReExportRegistered(opencodePluginPath(home), opencodeTarget);

  const piTarget = join(root, "dist", "pi.js");
  const piRegistered = isReExportRegistered(piExtensionPath(home), piTarget);

  const registeredClis: CliName[] = [];

  if (claudeRegistered) {
    registeredClis.push("claude-code");
  }

  if (codexRegistered) {
    registeredClis.push("codex");
  }

  if (opencodeRegistered) {
    registeredClis.push("opencode");
  }

  if (piRegistered) {
    registeredClis.push("pi");
  }

  return [
    describeRegistration({
      cli: "claude-code",
      registered: claudeRegistered,
      targetExists: existsSync(claudeCommand),
    }),
    describeRegistration({
      cli: "codex",
      registered: codexRegistered,
      targetExists: existsSync(codexCommand),
    }),
    describeRegistration({
      cli: "opencode",
      registered: opencodeRegistered,
      targetExists: existsSync(opencodeTarget),
    }),
    describeRegistration({
      cli: "pi",
      registered: piRegistered,
      targetExists: existsSync(piTarget),
    }),
    // A CLI with no hook has no use for the command, so only a registered CLI reports one.
    ...COMMAND_CLIS.filter((cli) => registeredClis.includes(cli)).map((cli) =>
      describeCommand(cli, home),
    ),
  ];
}

// The build script prepends this exact line, so a mismatch means the entry point was not built by scripts/build.mjs.
const SHEBANG_LINE = "#!/usr/bin/env node\n";

// A registered hook is invoked as a bare path, so a built file with no executable bit fails with EACCES at run time.
function isExecutable(path: string): boolean {
  try {
    return (statSync(path).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function hasShebang(path: string): boolean {
  try {
    return readFileSync(path, "utf-8").startsWith(SHEBANG_LINE);
  } catch {
    return false;
  }
}

function checkEntryPoints(root: string): DoctorCheck {
  const entryPoints = [
    "cli.js",
    "claude-code.js",
    "codex.js",
    "opencode.js",
    "pi.js",
    "pair-tui.js",
  ];
  const missing = entryPoints.filter((entry) => !existsSync(join(root, "dist", entry)));
  const present = entryPoints.filter((entry) => !missing.includes(entry));
  const notExecutable = present.filter((entry) => !isExecutable(join(root, "dist", entry)));
  const missingShebang = present.filter((entry) => !hasShebang(join(root, "dist", entry)));

  const problems: string[] = [];

  if (missing.length > 0) {
    problems.push(`missing: ${missing.join(", ")}`);
  }

  if (notExecutable.length > 0) {
    problems.push(`not executable: ${notExecutable.join(", ")}`);
  }

  if (missingShebang.length > 0) {
    problems.push(`missing shebang: ${missingShebang.join(", ")}`);
  }

  return {
    name: "dist/ entry points",
    passed: problems.length === 0,
    detail: problems.length === 0 ? "all built and executable" : problems.join("; "),
  };
}

// dist/pair-tui.js marks shiki external, so Node resolves it dynamically from node_modules at run time rather than from the bundle.
function checkShiki(resolvesShiki?: () => boolean): DoctorCheck {
  const resolve =
    resolvesShiki ??
    ((): boolean => {
      try {
        import.meta.resolve("shiki");
        return true;
      } catch {
        return false;
      }
    });

  const resolved = resolve();

  return {
    name: "shiki (syntax colour)",
    passed: resolved,
    warnOnly: true,
    detail: resolved
      ? "resolves from node_modules"
      : "not found in node_modules; syntax colour disabled",
  };
}

function checkTrace(config: PairConfig): DoctorCheck | null {
  if (!config.trace) {
    return null;
  }

  const tracePath = join(stateDir(), "trace.log");

  if (!existsSync(tracePath)) {
    return { name: "trace log", passed: true, detail: "tracing is on; no log written yet" };
  }

  const lines = readFileSync(tracePath, "utf-8")
    .split("\n")
    .filter((line) => line !== "");
  const tail = lines.slice(-10);

  return {
    name: "trace log",
    passed: true,
    detail: tail.length === 0 ? "empty" : tail.join(" | "),
  };
}

const defaultOpenTty = (): number => openSync("/dev/tty", "r+");

// A watcher that crashed leaves its socket file behind, so the probe distinguishes a live one from a stale one.
async function checkSession(
  config: PairConfig,
  directory: string,
  probe: DoctorOptions["probeSocket"],
): Promise<DoctorCheck> {
  const path = sessionSocketPath(directory);
  const name = `session: ${path}`;
  const wanted = config.transport === "session";

  if (!existsSync(path)) {
    return {
      name,
      passed: !wanted,
      detail: wanted
        ? "transport is session but no watcher is attached; run pair-mode watch"
        : "no watcher attached, and transport is pane",
      warnOnly: !wanted,
    };
  }

  const alive = await (probe ?? probeSocket)(path);

  if (alive) {
    return { name, passed: true, detail: "a watcher is attached" };
  }

  return { name, passed: false, detail: `stale socket, remove it with: rm ${path}` };
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const home = options.homeDir ?? homedir();
  const root = options.installRoot ?? installRoot();
  const openTty = options.openTty ?? defaultOpenTty;

  const loaded: ConfigResult =
    options.config === undefined ? loadConfig() : { config: options.config, errors: [] };
  const config = loaded.config;

  const checks: DoctorCheck[] = [
    checkConfig(loaded),
    checkEditor(config, options.resolvesOnPath),
    checkMultiplexer(config, options.multiplexerAdapters),
    checkControllingTerminal(openTty),
    ...checkClis(home, root),
    checkEntryPoints(root),
    checkShiki(options.resolvesShiki),
    await checkSession(config, options.directory ?? process.cwd(), options.probeSocket),
  ];

  const traceCheck = checkTrace(config);

  if (traceCheck !== null) {
    checks.push(traceCheck);
  }

  const exitCode = checks.every((check) => check.passed || check.warnOnly) ? 0 : 1;
  const text = checks
    .map(
      (check) =>
        `[${check.passed ? "PASS" : check.warnOnly ? "WARN" : "FAIL"}] ${check.name}: ${check.detail}`,
    )
    .join("\n");

  return { checks, exitCode, text };
}
