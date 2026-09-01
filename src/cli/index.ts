import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSetup } from "./setup";
import { runDoctor } from "./doctor";
import { pairOn, pairOnWeb, pairOff, pairStatus, pairToggle, currentSessionKey } from "./toggle";
import { createWatchIo } from "./watch";
import { runConfig } from "./config";
import { listSessions, runConnect, sweepDeadSessions } from "./sessions";
import { sessionsDir } from "../core/state";
import { installRoot } from "./install-root";
import { isRecord } from "../helpers";
import { watchSession } from "./watch-target";

const USAGE = `pair-mode <command> [directory]

Commands:
  setup                interactively configure pair mode and register hooks
  doctor               diagnose a pair mode install
  config               print every setting and its value
  config <key>         print one setting
  config <key> <value> change one setting
  on [dir]             turn pair mode on for a directory (default: cwd)
  on --web [dir]       turn pair mode on and serve the review in a browser
  off [dir]            turn pair mode off for a directory (default: cwd)
  toggle [dir]         flip pair mode for a directory (default: cwd)
  toggle --web [dir]   flip pair mode, and serve the review in a browser when it turns on
  status [dir]         report pair mode status for a directory (default: cwd)
  watch [dir]          review edits in this terminal (default: cwd)
  watch --web [dir]    serve the review in a browser and print the link
  watch <id>           review edits for one session (see: pair-mode sessions)
  sessions             list every live pair mode session
  connect              pick a session from a list and watch it
  --version            print the installed version
  --help               print this message
`;

function readVersion(): string {
  const pkgPath = join(installRoot(), "package.json");

  try {
    const raw: unknown = JSON.parse(readFileSync(pkgPath, "utf-8"));

    if (isRecord(raw) && typeof raw["version"] === "string") {
      return raw["version"];
    }
  } catch {
    // fall through to the unknown-version report below
  }

  return "unknown";
}

function isFlag(entry: string): boolean {
  return entry.startsWith("-") && entry !== "-";
}

// A flag read as a directory is worse than an error: "off --web" would resolve <cwd>/--web and leave pair mode on.
function parseDirectoryArgs(args: string[], allowedFlags: string[]) {
  const flags = args.filter(isFlag);
  const target = args.find((entry) => !isFlag(entry));

  return {
    directory: resolve(target ?? process.cwd()),
    web: flags.includes("--web"),
    unknownFlag: flags.find((flag) => !allowedFlags.includes(flag)) ?? null,
  };
}

const SESSION_KEY_PATTERN = /^s-[0-9a-f]{8}$/;
const SESSION_KEY_PREFIX = "s-";

// A `watch` argument is either a session key or a directory, and only one of them starts with `s-`.
function parseWatchArgs(args: string[]) {
  const flags = args.filter(isFlag);
  const target = args.find((entry) => !isFlag(entry));
  const looksLikeKey = target !== undefined && target.startsWith(SESSION_KEY_PREFIX);
  const isKey = looksLikeKey && SESSION_KEY_PATTERN.test(target);

  return {
    sessionKey: isKey ? target : undefined,
    malformedKey: looksLikeKey && !isKey ? target : null,
    directory: isKey ? process.cwd() : resolve(target ?? process.cwd()),
    web: flags.includes("--web"),
    unknownFlag: flags.find((flag) => flag !== "--web") ?? null,
  };
}

// `sessions` and `connect` name no target, so anything after the command is a mistake worth reporting.
function reportExtraArgs(command: string, args: string[]): number | null {
  const extra = args[0];

  if (extra === undefined) {
    return null;
  }

  if (isFlag(extra)) {
    return reportUnknownFlag(command, extra);
  }

  console.error(`unexpected argument for ${command}: ${extra}`);
  console.error(USAGE);
  return 1;
}

function reportUnknownFlag(command: string, flag: string): number {
  console.error(`unknown option for ${command}: ${flag}`);
  console.error(USAGE);
  return 1;
}

async function main(): Promise<number> {
  const command = process.argv[2] ?? "";

  if (command === "--help" || command === "-h") {
    console.log(USAGE);
    return 0;
  }

  if (command === "--version") {
    console.log(readVersion());
    return 0;
  }

  if (command === "setup") {
    const result = await runSetup();
    return result.stopped ? 1 : result.doctorExitCode;
  }

  if (command === "doctor") {
    const report = await runDoctor();
    console.log(report.text);
    return report.exitCode;
  }

  if (command === "config") {
    const result = runConfig(process.argv.slice(3));
    console.log(result.text);
    return result.exitCode;
  }

  if (command === "on") {
    const parsed = parseDirectoryArgs(process.argv.slice(3), ["--web"]);

    if (parsed.unknownFlag !== null) {
      return reportUnknownFlag(command, parsed.unknownFlag);
    }

    // A watcher that died leaves its socket behind, so starting pair mode clears the dead ones first.
    await sweepDeadSessions();

    const key = currentSessionKey();

    if (parsed.web) {
      console.log(await pairOnWeb(parsed.directory, process.argv[1] ?? "", key));
      return 0;
    }

    console.log(pairOn(parsed.directory, key));
    return 0;
  }

  if (command === "off") {
    const parsed = parseDirectoryArgs(process.argv.slice(3), []);

    if (parsed.unknownFlag !== null) {
      return reportUnknownFlag(command, parsed.unknownFlag);
    }

    console.log(pairOff(parsed.directory, currentSessionKey()));
    return 0;
  }

  if (command === "toggle") {
    const parsed = parseDirectoryArgs(process.argv.slice(3), ["--web"]);

    if (parsed.unknownFlag !== null) {
      return reportUnknownFlag(command, parsed.unknownFlag);
    }

    console.log(
      await pairToggle(parsed.directory, process.argv[1] ?? "", parsed.web, currentSessionKey()),
    );
    return 0;
  }

  if (command === "status") {
    const parsed = parseDirectoryArgs(process.argv.slice(3), []);

    if (parsed.unknownFlag !== null) {
      return reportUnknownFlag(command, parsed.unknownFlag);
    }

    console.log(pairStatus(parsed.directory, currentSessionKey()));
    return 0;
  }

  if (command === "watch") {
    const parsed = parseWatchArgs(process.argv.slice(3));

    if (parsed.unknownFlag !== null) {
      return reportUnknownFlag(command, parsed.unknownFlag);
    }

    // A well-formed id with no socket is the bootstrap case: the human read it off `pair-mode on`.
    if (parsed.malformedKey !== null) {
      console.error(`malformed session id: ${parsed.malformedKey}`);
      console.error(
        "an id is s- followed by eight hex characters; run pair-mode sessions to list them",
      );
      return 1;
    }

    return await watchSession({
      directory: parsed.directory,
      sessionKey: parsed.sessionKey,
      web: parsed.web,
    });
  }

  if (command === "sessions") {
    const rejected = reportExtraArgs(command, process.argv.slice(3));

    if (rejected !== null) {
      return rejected;
    }

    const result = await listSessions();
    console.log(result.text);
    return result.exitCode;
  }

  if (command === "connect") {
    const rejected = reportExtraArgs(command, process.argv.slice(3));

    if (rejected !== null) {
      return rejected;
    }

    const result = await runConnect(createWatchIo());
    const chosen = result.selected;

    if (chosen === null) {
      return result.exitCode;
    }

    // The listing already names the socket and the directory, so joining never re-derives either from the cwd.
    return await watchSession({
      directory: chosen.directory === "" ? process.cwd() : chosen.directory,
      sessionKey: chosen.kind === "session" ? chosen.id : undefined,
      socketPath: join(sessionsDir(), `${chosen.id}.sock`),
      web: false,
      terminalOnly: true,
    });
  }

  console.error(`unknown command: ${command}`);
  console.error(USAGE);
  return 1;
}

// A failure here is a message for the user, not a stack trace. Node would print one otherwise.
async function report(): Promise<number> {
  try {
    return await main();
  } catch (error) {
    console.error(`pair-mode: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const code = await report();
process.exit(code);
