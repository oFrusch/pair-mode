import { existsSync, openSync, closeSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, configPath } from "../core/config";
import { stateDir } from "../core/state";
import { resolve as resolveEditor } from "../editors/index";
import { detect as detectMultiplexer } from "../multiplexers/index";
import { installRoot } from "./install-root";
import {
  claudeCodeSettingsPath,
  codexHooksPath,
  isPreToolUseRegistered,
  isReExportRegistered,
  opencodePluginPath,
  piExtensionPath,
} from "./register";
import type { DoctorCheck, DoctorOptions, DoctorReport } from "./doctor.types";

function checkConfig(): DoctorCheck {
  const result = loadConfig();
  const path = configPath();

  if (result.errors.length === 0) {
    return { name: `config: ${path}`, passed: true, detail: "parses cleanly" };
  }

  const detail = result.errors.map((error) => `${error.path}: ${error.message}`).join("; ");
  return { name: `config: ${path}`, passed: false, detail };
}

function checkEditor(resolvesOnPath: DoctorOptions["resolvesOnPath"]): DoctorCheck {
  const config = loadConfig().config;
  const editor = resolveEditor(config.editor, resolvesOnPath);
  const available = editor.available();

  return {
    name: `editor: ${editor.name}`,
    passed: available,
    detail: available ? "binary present" : "binary not found on PATH",
  };
}

function checkMultiplexer(adapters: DoctorOptions["multiplexerAdapters"]): DoctorCheck {
  const config = loadConfig().config;
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
    detail: spec.targetExists ? "registered, target exists" : "registered, but target file is missing",
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

  return [
    describeRegistration({ cli: "claude-code", registered: claudeRegistered, targetExists: existsSync(claudeCommand) }),
    describeRegistration({ cli: "codex", registered: codexRegistered, targetExists: existsSync(codexCommand) }),
    describeRegistration({ cli: "opencode", registered: opencodeRegistered, targetExists: existsSync(opencodeTarget) }),
    describeRegistration({ cli: "pi", registered: piRegistered, targetExists: existsSync(piTarget) }),
  ];
}

// A registered hook is invoked as a bare path, so a built file with no executable bit fails with EACCES at run time.
function isExecutable(path: string): boolean {
  try {
    return (statSync(path).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function checkEntryPoints(root: string): DoctorCheck {
  const entryPoints = ["cli.js", "claude-code.js", "codex.js", "opencode.js", "pi.js"];
  const missing = entryPoints.filter((entry) => !existsSync(join(root, "dist", entry)));
  const notExecutable = entryPoints.filter(
    (entry) => !missing.includes(entry) && !isExecutable(join(root, "dist", entry)),
  );

  const problems: string[] = [];

  if (missing.length > 0) {
    problems.push(`missing: ${missing.join(", ")}`);
  }

  if (notExecutable.length > 0) {
    problems.push(`not executable: ${notExecutable.join(", ")}`);
  }

  return {
    name: "dist/ entry points",
    passed: problems.length === 0,
    detail: problems.length === 0 ? "all built and executable" : problems.join("; "),
  };
}

function checkTrace(): DoctorCheck | null {
  const config = loadConfig().config;

  if (!config.trace) {
    return null;
  }

  const tracePath = join(stateDir(), "trace.log");

  if (!existsSync(tracePath)) {
    return { name: "trace log", passed: true, detail: "tracing is on; no log written yet" };
  }

  const lines = readFileSync(tracePath, "utf-8").split("\n").filter((line) => line !== "");
  const tail = lines.slice(-10);

  return { name: "trace log", passed: true, detail: tail.length === 0 ? "empty" : tail.join(" | ") };
}

const defaultOpenTty = (): number => openSync("/dev/tty", "r+");

export function runDoctor(options: DoctorOptions = {}): DoctorReport {
  const home = options.homeDir ?? homedir();
  const root = options.installRoot ?? installRoot();
  const openTty = options.openTty ?? defaultOpenTty;

  const checks: DoctorCheck[] = [
    checkConfig(),
    checkEditor(options.resolvesOnPath),
    checkMultiplexer(options.multiplexerAdapters),
    checkControllingTerminal(openTty),
    ...checkClis(home, root),
    checkEntryPoints(root),
  ];

  const traceCheck = checkTrace();

  if (traceCheck !== null) {
    checks.push(traceCheck);
  }

  const exitCode = checks.every((check) => check.passed) ? 0 : 1;
  const text = checks.map((check) => `[${check.passed ? "PASS" : "FAIL"}] ${check.name}: ${check.detail}`).join("\n");

  return { checks, exitCode, text };
}
