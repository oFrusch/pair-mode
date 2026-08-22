import { test, expect, beforeEach, afterEach } from "vitest";
import { createZellijMultiplexer } from "../src/multiplexers/zellij";
import { createTmuxMultiplexer } from "../src/multiplexers/tmux";
import { createTtyMultiplexer } from "../src/multiplexers/tty";
import { detect, describe as describeAdapters } from "../src/multiplexers/index";
import type { Spawn, SpawnResult, TtyOpen, TtyRunner } from "../src/multiplexers/multiplexer.types";

let originalZellij: string | undefined;
let originalTmux: string | undefined;

beforeEach(() => {
  originalZellij = process.env["ZELLIJ"];
  originalTmux = process.env["TMUX"];
});

afterEach(() => {
  if (originalZellij === undefined) {
    delete process.env["ZELLIJ"];
  } else {
    process.env["ZELLIJ"] = originalZellij;
  }

  if (originalTmux === undefined) {
    delete process.env["TMUX"];
  } else {
    process.env["TMUX"] = originalTmux;
  }
});

function recordingSpawn(status = 0): { spawn: Spawn; calls: { command: string; args: string[] }[] } {
  const calls: { command: string; args: string[] }[] = [];

  const spawn: Spawn = (command, args): SpawnResult => {
    calls.push({ command, args });
    return { status, stderr: "" };
  };

  return { spawn, calls };
}

test("zellij run builds the blocking floating pane argv", () => {
  const { spawn, calls } = recordingSpawn();
  const zellij = createZellijMultiplexer(spawn);

  const result = zellij.run(["micro", "file.txt"], { width: "90%", height: "80%" });

  expect(result.ok).toBe(true);
  expect(calls).toHaveLength(1);
  const call = calls[0];
  expect(call).toBeDefined();
  expect(call?.command).toBe("zellij");
  expect(call?.args).toContain("--blocking");
  expect(call?.args).toContain("--floating");
  expect(call?.args).toContain("--close-on-exit");
  expect(call?.args).toContain("90%");
  expect(call?.args).toContain("80%");
  expect(call?.args).toEqual(
    expect.arrayContaining(["micro", "file.txt"]),
  );
});

test("zellij run reports the failure detail on a nonzero exit", () => {
  const spawn: Spawn = (): SpawnResult => ({ status: 1, stderr: "boom" });
  const zellij = createZellijMultiplexer(spawn);

  const result = zellij.run(["micro"], { width: "90%", height: "90%" });

  expect(result.ok).toBe(false);
  expect(result.detail).toBe("boom");
});

test("zellij available consults the injected PATH resolver, not the real PATH", () => {
  process.env["ZELLIJ"] = "0";
  const zellij = createZellijMultiplexer(recordingSpawn().spawn, () => false);

  expect(zellij.available()).toBe(false);
});

test("tmux run signals a wait channel and blocks on the same channel", () => {
  const { spawn, calls } = recordingSpawn();
  const tmux = createTmuxMultiplexer(spawn);

  const result = tmux.run(["micro", "file.txt"], { width: "90%", height: "90%" });

  expect(result.ok).toBe(true);
  expect(calls).toHaveLength(2);

  const popup = calls[0];
  const wait = calls[1];
  expect(popup).toBeDefined();
  expect(wait).toBeDefined();

  const script = popup?.args[popup.args.length - 1];
  expect(script).toBeDefined();
  expect(script).toContain("wait-for -S pair-");

  const channel = script?.match(/pair-\d+/)?.[0];
  expect(channel).toBeDefined();
  expect(wait?.command).toBe("tmux");
  expect(wait?.args).toEqual(["wait-for", channel]);
});

test("tmux run quotes an argv element containing a space", () => {
  const { spawn, calls } = recordingSpawn();
  const tmux = createTmuxMultiplexer(spawn);

  tmux.run(["micro", "path with space.txt"], { width: "90%", height: "90%" });

  const popup = calls[0];
  const script = popup?.args[popup.args.length - 1];
  expect(script).toContain("'path with space.txt'");
});

test("tmux run reports ok:false when the popup command fails", () => {
  const spawn: Spawn = (): SpawnResult => ({ status: 1, stderr: "no server" });
  const tmux = createTmuxMultiplexer(spawn);

  const result = tmux.run(["micro"], { width: "90%", height: "90%" });

  expect(result.ok).toBe(false);
  expect(result.detail).toBe("no server");
});

test("tmux available consults the injected PATH resolver, not the real PATH", () => {
  process.env["TMUX"] = "/tmp/tmux-0/default,123,0";
  const tmux = createTmuxMultiplexer(recordingSpawn().spawn, () => false);

  expect(tmux.available()).toBe(false);
});

test("detect(auto) picks zellij when ZELLIJ is set and the resolver reports it on PATH", () => {
  process.env["ZELLIJ"] = "0";
  delete process.env["TMUX"];

  const zellij = createZellijMultiplexer(recordingSpawn().spawn, () => true);
  const tmux = createTmuxMultiplexer(recordingSpawn().spawn, () => true);
  const tty = createTtyMultiplexer();

  const adapter = detect("auto", { zellij, tmux, tty });

  expect(adapter).toBe(zellij);
});

test("detect(auto) picks tmux when only TMUX is set and the resolver reports it on PATH", () => {
  delete process.env["ZELLIJ"];
  process.env["TMUX"] = "/tmp/tmux-0/default,123,0";

  const zellij = createZellijMultiplexer(recordingSpawn().spawn, () => false);
  const tmux = createTmuxMultiplexer(recordingSpawn().spawn, () => true);
  const tty = createTtyMultiplexer();

  const adapter = detect("auto", { zellij, tmux, tty });

  expect(adapter).toBe(tmux);
});

test("detect(auto) returns the tty adapter when neither ZELLIJ nor TMUX is set", () => {
  delete process.env["ZELLIJ"];
  delete process.env["TMUX"];

  const zellij = createZellijMultiplexer(recordingSpawn().spawn, () => false);
  const tmux = createTmuxMultiplexer(recordingSpawn().spawn, () => false);
  const tty = createTtyMultiplexer();

  const adapter = detect("auto", { zellij, tmux, tty });

  expect(adapter).toBe(tty);
});

test("detect returns the named adapter regardless of availability", () => {
  const zellij = createZellijMultiplexer(recordingSpawn().spawn, () => false);
  const tmux = createTmuxMultiplexer(recordingSpawn().spawn, () => false);
  const tty = createTtyMultiplexer();

  expect(detect("zellij", { zellij, tmux, tty })).toBe(zellij);
  expect(detect("tmux", { zellij, tmux, tty })).toBe(tmux);
  expect(detect("none", { zellij, tmux, tty })).toBe(tty);
});

test("tty adapter returns ok:false with the ENXIO detail when the open fails", () => {
  const open: TtyOpen = () => {
    throw Object.assign(new Error("ENXIO"), { code: "ENXIO" });
  };
  const tty = createTtyMultiplexer(open);

  const result = tty.run(["micro", "file.txt"], { width: "90%", height: "90%" });

  expect(result.ok).toBe(false);
  expect(result.detail).toBe("no controlling terminal (ENXIO)");
});

test("tty adapter availability is false when the open fails", () => {
  const open: TtyOpen = () => {
    throw new Error("ENXIO");
  };
  const tty = createTtyMultiplexer(open);

  expect(tty.available()).toBe(false);
});

test("tty adapter run reports the runner's failure detail", () => {
  const open: TtyOpen = () => 99;
  const runner: TtyRunner = (): { ok: boolean; detail: string } => ({
    ok: false,
    detail: "exit code 1: no such editor",
  });
  const tty = createTtyMultiplexer(open, runner);

  const result = tty.run(["missing-editor"], { width: "90%", height: "90%" });

  expect(result.ok).toBe(false);
  expect(result.detail).toBe("exit code 1: no such editor");
});

test("describe returns one line per adapter", () => {
  const lines = describeAdapters();

  expect(lines).toHaveLength(3);
  expect(lines.some((line) => line.startsWith("zellij:"))).toBe(true);
  expect(lines.some((line) => line.startsWith("tmux:"))).toBe(true);
  expect(lines.some((line) => line.startsWith("none:"))).toBe(true);
});
