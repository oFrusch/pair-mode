import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runSetup } from "./setup";
import { runDoctor } from "./doctor";
import { pairOn, pairOff, pairStatus } from "./toggle";
import { installRoot } from "./install-root";
import { isRecord } from "../helpers";

const USAGE = `pair-mode <command> [directory]

Commands:
  setup     interactively configure pair mode and register hooks
  doctor    diagnose a pair mode install
  on        turn pair mode on for a directory (default: cwd)
  off       turn pair mode off for a directory (default: cwd)
  status    report pair mode status for a directory (default: cwd)
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
    const report = runDoctor();
    console.log(report.text);
    return report.exitCode;
  }

  if (command === "on") {
    console.log(pairOn(process.argv[3] ?? process.cwd()));
    return 0;
  }

  if (command === "off") {
    console.log(pairOff(process.argv[3] ?? process.cwd()));
    return 0;
  }

  if (command === "status") {
    console.log(pairStatus(process.argv[3] ?? process.cwd()));
    return 0;
  }

  console.error(`unknown command: ${command}`);
  console.error(USAGE);
  return 1;
}

const code = await main();
process.exit(code);
