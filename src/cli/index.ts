import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSetup } from "./setup";
import { runDoctor } from "./doctor";
import { pairOn, pairOnWeb, pairOff, pairStatus } from "./toggle";
import { runWatch } from "./watch";
import { startWebWatch } from "../web";
import { loadConfig } from "../core/config";
import { installRoot } from "./install-root";
import { isRecord } from "../helpers";

const USAGE = `pair-mode <command> [directory]

Commands:
  setup     interactively configure pair mode and register hooks
  doctor    diagnose a pair mode install
  on        turn pair mode on for a directory (default: cwd)
  on --web  turn pair mode on and serve the review in a browser
  off       turn pair mode off for a directory (default: cwd)
  status    report pair mode status for a directory (default: cwd)
  watch     review edits in this terminal (default: cwd)
  watch --web  serve the review in a browser and print the link
  --version print the installed version
  --help    print this message
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

  if (command === "on") {
    const rest = process.argv.slice(3);
    const target = rest.find((entry) => !entry.startsWith("--"));
    const directory = resolve(target ?? process.cwd());

    if (rest.includes("--web")) {
      console.log(await pairOnWeb(directory, process.argv[1] ?? ""));
      return 0;
    }

    console.log(pairOn(directory));
    return 0;
  }

  if (command === "off") {
    console.log(pairOff(resolve(process.argv[3] ?? process.cwd())));
    return 0;
  }

  if (command === "status") {
    console.log(pairStatus(resolve(process.argv[3] ?? process.cwd())));
    return 0;
  }

  if (command === "watch") {
    const rest = process.argv.slice(3);
    const wantsWeb = rest.includes("--web");
    const target = rest.find((entry) => !entry.startsWith("--"));
    const directory = resolve(target ?? process.cwd());
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

const code = await main();
process.exit(code);
