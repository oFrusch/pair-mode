import { mkdtempSync, mkdirSync, writeFileSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, beforeEach, afterEach } from "vitest";
import { runDoctor } from "../src/cli/doctor";
import { registerClaudeCode, registerCodex, registerOpencode, registerPi } from "../src/cli/register";
import { saveConfig } from "../src/core/config";
import type { PairConfig } from "../src/core/config.types";

let homeDir: string;
let installDir: string;
let originalHome: string | undefined;
let originalXdgConfigHome: string | undefined;
let originalXdgStateHome: string | undefined;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "pair-mode-home-"));
  installDir = mkdtempSync(join(tmpdir(), "pair-mode-install-"));

  originalHome = process.env["HOME"];
  process.env["HOME"] = homeDir;

  originalXdgConfigHome = process.env["XDG_CONFIG_HOME"];
  process.env["XDG_CONFIG_HOME"] = mkdtempSync(join(tmpdir(), "pair-mode-xdg-config-"));

  originalXdgStateHome = process.env["XDG_STATE_HOME"];
  process.env["XDG_STATE_HOME"] = mkdtempSync(join(tmpdir(), "pair-mode-xdg-state-"));
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env["HOME"];
  } else {
    process.env["HOME"] = originalHome;
  }

  if (originalXdgConfigHome === undefined) {
    delete process.env["XDG_CONFIG_HOME"];
  } else {
    process.env["XDG_CONFIG_HOME"] = originalXdgConfigHome;
  }

  if (originalXdgStateHome === undefined) {
    delete process.env["XDG_STATE_HOME"];
  } else {
    process.env["XDG_STATE_HOME"] = originalXdgStateHome;
  }
});

test("doctor on an unconfigured machine exits 1 and names each failing check", () => {
  const report = runDoctor({
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: () => false,
    openTty: () => {
      throw Object.assign(new Error("ENXIO"), { code: "ENXIO" });
    },
  });

  expect(report.exitCode).toBe(1);

  const failing = report.checks.filter((check) => !check.passed).map((check) => check.name);
  expect(failing).toContain("editor: vim");
  expect(failing).toContain("controlling terminal");
  expect(failing).toContain("claude-code hook");
  expect(failing).toContain("codex hook");
  expect(failing).toContain("opencode hook");
  expect(failing).toContain("pi hook");
  expect(failing).toContain("dist/ entry points");
});

test("doctor on a fully configured temporary home exits 0", () => {
  const config: PairConfig = {
    editor: "micro",
    multiplexer: "tmux",
    layout: "split",
    context: 5,
    minFold: 3,
    pane: { width: "90%", height: "90%" },
    theme: { add: "#1e3a1e", del: "#3a1e1e", fold: "#2a2a2a" },
    trace: false,
  };
  saveConfig(config);

  registerClaudeCode(homeDir, installDir);
  registerCodex(homeDir, installDir);
  registerOpencode(homeDir, installDir);
  registerPi(homeDir, installDir);

  const distDir = join(installDir, "dist");
  mkdirSync(distDir, { recursive: true });
  for (const entry of ["cli.js", "claude-code.js", "codex.js", "opencode.js", "pi.js"]) {
    writeFileSync(join(distDir, entry), "// stub\n", "utf-8");
  }

  const tmuxMultiplexer = {
    name: "tmux" as const,
    available: () => true,
    run: () => ({ ok: true, detail: "" }),
  };

  const fakeTtyPath = join(homeDir, "fake-tty");
  writeFileSync(fakeTtyPath, "", "utf-8");

  const report = runDoctor({
    homeDir: homeDir,
    installRoot: installDir,
    resolvesOnPath: () => true,
    openTty: () => openSync(fakeTtyPath, "r+"),
    multiplexerAdapters: { tmux: tmuxMultiplexer },
  });

  const failing = report.checks.filter((check) => !check.passed);
  expect(failing).toEqual([]);
  expect(report.exitCode).toBe(0);
});
