import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const LEVELS = ["patch", "minor", "major"];
const RELEASE_BRANCH = "main";

const args = process.argv.slice(2);
const level = args.find((arg) => LEVELS.includes(arg));
const dryRun = args.includes("--dry-run");

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

// Every command runs from the project root, so a release never depends on the caller's directory.
function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: projectRoot,
    stdio: options.capture === true ? "pipe" : "inherit",
    encoding: "utf-8",
  });

  if (result.status !== 0 && options.allowFailure !== true) {
    fail(`${command} ${commandArgs.join(" ")} exited ${result.status}`);
  }

  return result;
}

function capture(command, commandArgs) {
  return run(command, commandArgs, { capture: true, allowFailure: true }).stdout?.trim() ?? "";
}

function packageJsonPath() {
  return path.join(projectRoot, "package.json");
}

function readVersion() {
  return JSON.parse(readFileSync(packageJsonPath(), "utf-8")).version;
}

// The release commit must describe exactly what the tag points at, so an unrelated edit stops the run.
function requireCleanTree() {
  if (capture("git", ["status", "--porcelain"]) !== "") {
    fail("the working tree has uncommitted changes. Commit or stash them first.");
  }
}

function requireReleaseBranch() {
  const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);

  if (branch !== RELEASE_BRANCH) {
    fail(`releases run from ${RELEASE_BRANCH}, and this is ${branch}.`);
  }
}

// A release built from a stale checkout would publish code the remote does not have.
function requireSyncedWithRemote() {
  run("git", ["fetch", "--quiet", "origin", RELEASE_BRANCH]);

  const local = capture("git", ["rev-parse", "HEAD"]);
  const remote = capture("git", ["rev-parse", `origin/${RELEASE_BRANCH}`]);

  if (local !== remote) {
    fail(`HEAD and origin/${RELEASE_BRANCH} differ. Pull or push first.`);
  }
}

function requireUnusedTag(tag) {
  if (capture("git", ["tag", "--list", tag]) !== "") {
    fail(`tag ${tag} already exists.`);
  }
}

function runGates() {
  console.log("release: running the gates");
  run("pnpm", ["run", "typecheck"]);
  run("pnpm", ["run", "lint"]);
  run("pnpm", ["run", "fmt:check"]);
  run("pnpm", ["test"]);
  run("pnpm", ["run", "build"]);
}

function bumpVersion() {
  run("npm", ["version", level, "--no-git-tag-version"]);
  return readVersion();
}

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

// The Unreleased heading becomes the new version section, and a fresh empty Unreleased takes its place.
function rollChangelog(version) {
  const changelogPath = path.join(projectRoot, "CHANGELOG.md");
  const text = readFileSync(changelogPath, "utf-8");
  const heading = "## [Unreleased]";

  if (!text.includes(heading)) {
    fail("CHANGELOG.md has no `## [Unreleased]` heading.");
  }

  const body = text.slice(text.indexOf(heading) + heading.length);
  const nextHeadingIndex = body.indexOf("\n## ");
  const entries = (nextHeadingIndex === -1 ? body : body.slice(0, nextHeadingIndex)).trim();

  if (entries === "") {
    console.log("release: the Unreleased section is empty, so the new section records no entries.");
  }

  const replacement = `${heading}\n\n## [${version}] - ${today()}`;

  writeFileSync(changelogPath, text.replace(heading, replacement), "utf-8");
}

function main() {
  if (level === undefined) {
    fail(`name a level: ${LEVELS.join(", ")}. Add --dry-run to stop before the publish.`);
  }

  requireReleaseBranch();
  requireCleanTree();
  requireSyncedWithRemote();
  runGates();

  const version = bumpVersion();
  const tag = `v${version}`;

  requireUnusedTag(tag);
  rollChangelog(version);

  run("git", ["add", "package.json", "CHANGELOG.md"]);
  run("git", ["commit", "-m", `chore(release): ${tag}`]);
  run("git", ["tag", "-a", tag, "-m", tag]);

  if (dryRun) {
    console.log(`release: --dry-run stops here. ${tag} is committed and tagged locally.`);
    console.log(`release: undo with git tag -d ${tag} && git reset --hard HEAD~1`);
    return;
  }

  // npm publish comes before the push, because a failed publish leaves nothing on the remote to undo.
  run("npm", ["publish"]);
  run("git", ["push", "origin", RELEASE_BRANCH]);
  run("git", ["push", "origin", tag]);

  console.log(`release: published ${tag}`);
}

main();
