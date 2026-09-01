import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSetup } from "./setup";
import { runDoctor } from "./doctor";
import { pairOn, pairOnWeb, pairOff, pairStatus, pairToggle } from "./toggle";
import { runWatch } from "./watch";
import { runConfig } from "./config";
import { startWebWatch } from "../web";
import { loadConfig } from "../core/config";
import { installRoot } from "./install-root";
import { isRecord } from "../helpers";

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

    if (parsed.web) {
      console.log(await pairOnWeb(parsed.directory, process.argv[1] ?? ""));
      return 0;
    }

    console.log(pairOn(parsed.directory));
    return 0;
  }

  if (command === "off") {
    const parsed = parseDirectoryArgs(process.argv.slice(3), []);

    if (parsed.unknownFlag !== null) {
      return reportUnknownFlag(command, parsed.unknownFlag);
    }

    console.log(pairOff(parsed.directory));
    return 0;
  }

  if (command === "toggle") {
    const parsed = parseDirectoryArgs(process.argv.slice(3), ["--web"]);

    if (parsed.unknownFlag !== null) {
      return reportUnknownFlag(command, parsed.unknownFlag);
    }

    console.log(await pairToggle(parsed.directory, process.argv[1] ?? "", parsed.web));
    return 0;
  }

  if (command === "status") {
    const parsed = parseDirectoryArgs(process.argv.slice(3), []);

    if (parsed.unknownFlag !== null) {
      return reportUnknownFlag(command, parsed.unknownFlag);
    }

    console.log(pairStatus(parsed.directory));
    return 0;
  }

  if (command === "watch") {
    const parsed = parseDirectoryArgs(process.argv.slice(3), ["--web"]);

    if (parsed.unknownFlag !== null) {
      return reportUnknownFlag(command, parsed.unknownFlag);
    }

    const wantsWeb = parsed.web;
    const directory = parsed.directory;
    const { config, errors } = loadConfig();

    errors.forEach((error) => console.error(`config ${error.path}: ${error.message}`));

    if (!wantsWeb && !config.web.enabled) {
      return runWatch({ directory }, config);
    }

    const watcher = await startWebWatch({ directory, port: config.web.port }, config);

    console.log(`pair mode is watching ${directory}`);
    console.log(watcher.url);

    // The web watcher has no TTY loop of its own, so the process stays alive until a signal stops it.
    await new Promise<void>((done) => {
      const stop = (): void => {
        void watcher.close().then(done);
      };

      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });

    return 0;
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
