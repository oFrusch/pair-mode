import { mkdirSync, writeFileSync, openSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { test, expect, beforeEach } from "vitest";
import { runDoctor } from "../src/cli/doctor";
import {
  registerClaudeCode,
  registerCodex,
  registerOpencode,
  registerPairCommand,
  registerPi,
} from "../src/cli/register";
import { saveConfig } from "../src/core/config";
import type { PairConfig } from "../src/core/config";
import { useIsolatedHome } from "./helpers/env";

const isolated = useIsolatedHome();

let homeDir: string;
let installDir: string;

beforeEach(() => {
  homeDir = isolated.home;
  installDir = isolated.tempDir("pair-mode-install-");
});

test("doctor on an unconfigured machine exits 1 and names each failing check", async () => {
  const report = await runDoctor({
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: () => false,
    openTty: () => {
      throw Object.assign(new Error("ENXIO"), { code: "ENXIO" });
    },
  });

  expect(report.exitCode).toBe(1);

  // The pair editor is always available, so config.editor "auto" now resolves to it and the editor check passes even here.
  const failing = report.checks.filter((check) => !check.passed).map((check) => check.name);
  expect(failing).toContain("controlling terminal");
  expect(failing).toContain("claude-code hook");
  expect(failing).toContain("codex hook");
  expect(failing).toContain("dist/ entry points");

  // opencode and pi ship in 1.0.0, so doctor stays quiet about a CLI the user never registered.
  expect(failing).not.toContain("opencode hook");
  expect(failing).not.toContain("pi hook");
});

test("doctor on a fully configured temporary home exits 0", async () => {
  const config: PairConfig = {
    editor: "micro",
    multiplexer: "tmux",
    layout: "split",
    context: 5,
    minFold: 3,
    pane: { width: "90%", height: "90%" },
    transport: "pane",
    session: { timeout: 300 },
    web: { enabled: false, port: 0 },
    theme: { add: "#1e3a1e", del: "#3a1e1e", fold: "#2a2a2a", rowBand: false },
    trace: false,
    autoApprove: true,
    notes: "panel",
    syntax: true,
  };
  saveConfig(config);

  registerClaudeCode(homeDir, installDir);
  registerCodex(homeDir, installDir);
  registerOpencode(homeDir, installDir);
  registerPi(homeDir, installDir);
  registerPairCommand(homeDir, "claude-code");
  registerPairCommand(homeDir, "codex");
  registerPairCommand(homeDir, "opencode");
  registerPairCommand(homeDir, "pi");

  const distDir = join(installDir, "dist");
  mkdirSync(distDir, { recursive: true });
  for (const entry of [
    "cli.js",
    "claude-code.js",
    "codex.js",
    "opencode.js",
    "pi.js",
    "pair-tui.js",
  ]) {
    const entryPath = join(distDir, entry);
    writeFileSync(entryPath, "#!/usr/bin/env node\n// stub\n", "utf-8");
    chmodSync(entryPath, 0o755);
  }

  const tmuxMultiplexer = {
    name: "tmux" as const,
    available: () => true,
    run: () => ({ ok: true, detail: "" }),
  };

  const fakeTtyPath = join(homeDir, "fake-tty");
  writeFileSync(fakeTtyPath, "", "utf-8");

  const report = await runDoctor({
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: () => true,
    openTty: () => openSync(fakeTtyPath, "r+"),
    multiplexerAdapters: { tmux: tmuxMultiplexer },
    resolvesShiki: () => true,
  });

  const failing = report.checks.filter((check) => !check.passed);
  expect(failing).toEqual([]);
  expect(report.exitCode).toBe(0);
});

test("doctor fails the entry points check when a built file is not executable", async () => {
  const config: PairConfig = {
    editor: "micro",
    multiplexer: "tmux",
    layout: "split",
    context: 5,
    minFold: 3,
    pane: { width: "90%", height: "90%" },
    transport: "pane",
    session: { timeout: 300 },
    web: { enabled: false, port: 0 },
    theme: { add: "#1e3a1e", del: "#3a1e1e", fold: "#2a2a2a", rowBand: false },
    trace: false,
    autoApprove: true,
    notes: "panel",
    syntax: true,
  };
  saveConfig(config);

  registerClaudeCode(homeDir, installDir);
  registerCodex(homeDir, installDir);
  registerOpencode(homeDir, installDir);
  registerPi(homeDir, installDir);

  const distDir = join(installDir, "dist");
  mkdirSync(distDir, { recursive: true });

  for (const entry of [
    "cli.js",
    "claude-code.js",
    "codex.js",
    "opencode.js",
    "pi.js",
    "pair-tui.js",
  ]) {
    const entryPath = join(distDir, entry);
    writeFileSync(entryPath, "#!/usr/bin/env node\n// stub\n", "utf-8");
    chmodSync(entryPath, entry === "claude-code.js" ? 0o644 : 0o755);
  }

  const tmuxMultiplexer = {
    name: "tmux" as const,
    available: () => true,
    run: () => ({ ok: true, detail: "" }),
  };

  const fakeTtyPath = join(homeDir, "fake-tty");
  writeFileSync(fakeTtyPath, "", "utf-8");

  const report = await runDoctor({
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: () => true,
    openTty: () => openSync(fakeTtyPath, "r+"),
    multiplexerAdapters: { tmux: tmuxMultiplexer },
    resolvesShiki: () => true,
  });

  expect(report.exitCode).toBe(1);

  const entryCheck = report.checks.find((check) => check.name === "dist/ entry points");
  expect(entryCheck?.passed).toBe(false);
  expect(entryCheck?.detail).toContain("not executable: claude-code.js");
});

function setUpFullInstall(
  homeDir: string,
  installDir: string,
): {
  distDir: string;
  fakeTtyPath: string;
  tmuxMultiplexer: {
    name: "tmux";
    available: () => boolean;
    run: () => { ok: boolean; detail: string };
  };
} {
  const config: PairConfig = {
    editor: "micro",
    multiplexer: "tmux",
    layout: "split",
    context: 5,
    minFold: 3,
    pane: { width: "90%", height: "90%" },
    transport: "pane",
    session: { timeout: 300 },
    web: { enabled: false, port: 0 },
    theme: { add: "#1e3a1e", del: "#3a1e1e", fold: "#2a2a2a", rowBand: false },
    trace: false,
    autoApprove: true,
    notes: "panel",
    syntax: true,
  };
  saveConfig(config);

  registerClaudeCode(homeDir, installDir);
  registerCodex(homeDir, installDir);
  registerOpencode(homeDir, installDir);
  registerPi(homeDir, installDir);

  const distDir = join(installDir, "dist");
  mkdirSync(distDir, { recursive: true });
  for (const entry of ["cli.js", "claude-code.js", "codex.js", "opencode.js", "pi.js"]) {
    const entryPath = join(distDir, entry);
    writeFileSync(entryPath, "#!/usr/bin/env node\n// stub\n", "utf-8");
    chmodSync(entryPath, 0o755);
  }

  const fakeTtyPath = join(homeDir, "fake-tty");
  writeFileSync(fakeTtyPath, "", "utf-8");

  const tmuxMultiplexer = {
    name: "tmux" as const,
    available: () => true,
    run: () => ({ ok: true, detail: "" }),
  };

  return { distDir, fakeTtyPath, tmuxMultiplexer };
}

test("doctor fails when dist/pair-tui.js is absent", async () => {
  const { fakeTtyPath, tmuxMultiplexer } = setUpFullInstall(homeDir, installDir);

  const report = await runDoctor({
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: () => true,
    openTty: () => openSync(fakeTtyPath, "r+"),
    multiplexerAdapters: { tmux: tmuxMultiplexer },
    resolvesShiki: () => true,
  });

  expect(report.exitCode).toBe(1);

  const entryCheck = report.checks.find((check) => check.name === "dist/ entry points");
  expect(entryCheck?.passed).toBe(false);
  expect(entryCheck?.detail).toContain("missing: pair-tui.js");
});

test("doctor fails when dist/pair-tui.js exists with mode 644", async () => {
  const { distDir, fakeTtyPath, tmuxMultiplexer } = setUpFullInstall(homeDir, installDir);

  const tuiPath = join(distDir, "pair-tui.js");
  writeFileSync(tuiPath, "#!/usr/bin/env node\n// stub\n", "utf-8");
  chmodSync(tuiPath, 0o644);

  const report = await runDoctor({
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: () => true,
    openTty: () => openSync(fakeTtyPath, "r+"),
    multiplexerAdapters: { tmux: tmuxMultiplexer },
    resolvesShiki: () => true,
  });

  expect(report.exitCode).toBe(1);

  const entryCheck = report.checks.find((check) => check.name === "dist/ entry points");
  expect(entryCheck?.passed).toBe(false);
  expect(entryCheck?.detail).toContain("not executable: pair-tui.js");
});

test("doctor passes when dist/pair-tui.js exists with mode 755 and the shebang", async () => {
  const { distDir, fakeTtyPath, tmuxMultiplexer } = setUpFullInstall(homeDir, installDir);

  const tuiPath = join(distDir, "pair-tui.js");
  writeFileSync(tuiPath, "#!/usr/bin/env node\n// stub\n", "utf-8");
  chmodSync(tuiPath, 0o755);

  const report = await runDoctor({
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: () => true,
    openTty: () => openSync(fakeTtyPath, "r+"),
    multiplexerAdapters: { tmux: tmuxMultiplexer },
    resolvesShiki: () => true,
  });

  const entryCheck = report.checks.find((check) => check.name === "dist/ entry points");
  expect(entryCheck?.passed).toBe(true);
  expect(report.exitCode).toBe(0);
});

test("doctor reports WARN, not FAIL, when shiki does not resolve", async () => {
  const { distDir, fakeTtyPath, tmuxMultiplexer } = setUpFullInstall(homeDir, installDir);

  const tuiPath = join(distDir, "pair-tui.js");
  writeFileSync(tuiPath, "#!/usr/bin/env node\n// stub\n", "utf-8");
  chmodSync(tuiPath, 0o755);

  const report = await runDoctor({
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: () => true,
    openTty: () => openSync(fakeTtyPath, "r+"),
    multiplexerAdapters: { tmux: tmuxMultiplexer },
    resolvesShiki: () => false,
  });

  const shikiCheck = report.checks.find((check) => check.name === "shiki (syntax colour)");
  expect(shikiCheck?.passed).toBe(false);
  expect(shikiCheck?.warnOnly).toBe(true);
  expect(report.text).toContain("[WARN] shiki (syntax colour)");
  expect(report.text).not.toContain("[FAIL] shiki (syntax colour)");
  expect(report.exitCode).toBe(0);
});
