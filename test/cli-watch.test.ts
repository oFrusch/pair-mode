import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { runWatch } from "../src/cli/watch";
import type { WatchIo } from "../src/cli/watch";
import { DEFAULT_CONFIG } from "../src/core/config";
import type { PairConfig } from "../src/core/config";
import {
  sessionKey,
  sessionKeySocketPath,
  sessionSocketPath,
  sessionUrlPath,
} from "../src/core/state";
import { startWebWatch } from "../src/web";
import type { WebWatcher } from "../src/web";
import { createLineReader, decodeLine, encode } from "../src/transports/session";
import type { WireMessage } from "../src/transports/session";
import { isRecord } from "../src/helpers";
import { useIsolatedHome, useShortStateHome } from "./helpers/env";

const isolated = useIsolatedHome();

const WAIT_TIMEOUT_MS = 4000;
const POLL_MS = 5;
const TOKEN = "0123456789abcdef0123456789abcdef";

const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";
const CLEAR_SCREEN = "\x1b[2J\x1b[H";

const CTRL_C = "\x03";
const SEND_KEY = "s";
const QUIT_KEY = "q";

const config: PairConfig = { ...DEFAULT_CONFIG, syntax: false, context: 1, minFold: 1 };

interface FakeWatchIo {
  io: WatchIo;
  writes: string[];
  feed(chunk: string): void;
  resize(): void;
  shutdownCalls(): number;
  cleanupCalls(): number;
}

// runWatch rebinds the key handler every time control moves between the idle screen and the TUI.
function makeFakeIo(): FakeWatchIo {
  let keyHandler: ((chunk: string) => void) | null = null;
  let resizeHandler: (() => void) | null = null;

  const writes: string[] = [];
  const counts = { shutdown: 0, cleanup: 0 };

  const io: WatchIo = {
    isTty() {
      return true;
    },

    onKey(handler) {
      keyHandler = handler;
    },

    onResize(handler) {
      resizeHandler = handler;
    },

    write(text) {
      writes.push(text);
    },

    size() {
      return { width: 80, height: 24 };
    },

    cleanup() {
      counts.cleanup += 1;
      keyHandler = null;
    },

    shutdown() {
      counts.shutdown += 1;
      keyHandler = null;
      resizeHandler = null;
    },
  };

  return {
    io,
    writes,
    feed: (chunk) => keyHandler?.(chunk),
    resize: () => resizeHandler?.(),
    shutdownCalls: () => counts.shutdown,
    cleanupCalls: () => counts.cleanup,
  };
}

interface Agent {
  socket: Socket;
  received: WireMessage[];
  submit(path: string): void;
}

let directory: string;
let socketPath: string;
let watcher: WebWatcher | null = null;

const openSockets: Socket[] = [];
const running = new Map<FakeWatchIo, Promise<number>>();

beforeEach(() => {
  directory = isolated.tempDir("pair-watch-");
  socketPath = join(directory, "s.sock");
});

afterEach(async () => {
  for (const [fake, done] of running) {
    fake.feed(QUIT_KEY);
    await done.catch(() => 0);
  }

  running.clear();

  if (watcher !== null) {
    await watcher.close();
    watcher = null;
  }

  openSockets.forEach((socket) => socket.destroy());
  openSockets.length = 0;
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A socket round trip has no completion callback, so a test waits on the condition it cares about.
async function waitFor(label: string, ready: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;

  while (!ready()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }

    await sleep(POLL_MS);
  }
}

// The watcher probes the socket before it binds, so an agent waits for the listener rather than racing it.
async function connectAgent(order: string[], name: string): Promise<Agent> {
  await waitFor("the watcher socket", () => existsSync(socketPath));

  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const received: WireMessage[] = [];
    const readLines = createLineReader();

    openSockets.push(socket);
    socket.setEncoding("utf-8");

    socket.on("data", (chunk: string) => {
      readLines(chunk).forEach((line) => {
        const message = decodeLine(line);

        if (message === null) {
          return;
        }

        received.push(message);

        if (message.type === "verdict") {
          order.push(name);
        }
      });
    });

    socket.once("error", reject);

    socket.once("connect", () => {
      resolve({
        socket,
        received,
        submit: (path: string) =>
          socket.write(
            encode({
              type: "submit",
              tool: "edit",
              path,
              before: "const a = 1;\n",
              after: "const a = 2;\n",
            }),
          ),
      });
    });
  });
}

function startWatcher(): FakeWatchIo {
  const fake = makeFakeIo();

  running.set(fake, runWatch({ directory, socketPath, io: fake.io }, config));

  return fake;
}

// The afterEach quits whatever is left, so a test that quits on its own takes its watcher off that list.
function quitWith(fake: FakeWatchIo, key: string): Promise<number> {
  const done = running.get(fake);

  if (done === undefined) {
    throw new Error("that watcher was never started");
  }

  running.delete(fake);
  fake.feed(key);

  return done;
}

function finish(fake: FakeWatchIo): Promise<number> {
  return quitWith(fake, QUIT_KEY);
}

function altScreenCount(writes: readonly string[]): number {
  return writes.filter((text) => text === ALT_SCREEN_ON).length;
}

// The stream opens with a comment line, so a reader keeps pulling until the event it wants arrives.
async function openViewer(url: string): Promise<{
  until(marker: string): Promise<string>;
  cancel(): void;
}> {
  const response = await fetch(url);
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  let text = "";

  return {
    async until(marker: string): Promise<string> {
      while (!text.includes(marker)) {
        const chunk = await reader?.read();

        if (chunk === undefined || chunk.done) {
          break;
        }

        text += decoder.decode(chunk.value, { stream: true });
      }

      return text;
    },

    cancel: () => void reader?.cancel(),
  };
}

// The server names the sidecar from the socket, so a test that checks ownership derives it the same way.
function recordPathFor(path: string): string {
  return path.replace(/\.sock$/, ".json");
}

function resultFilesInTmp(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith("pair-result-"));
}

describe("runWatch quitting", () => {
  test("q at the idle screen resolves with 0 and shuts the io down once", async () => {
    const fake = startWatcher();

    await waitFor("the idle screen", () => fake.writes.length > 0);

    const code = await finish(fake);

    expect(code).toBe(0);
    expect(fake.shutdownCalls()).toBe(1);
  });

  test("ctrl c at the idle screen quits the same way q does", async () => {
    const fake = startWatcher();

    await waitFor("the idle screen", () => fake.writes.length > 0);

    const code = await quitWith(fake, CTRL_C);

    expect(code).toBe(0);
  });

  test("a resize while idle repaints the idle screen", async () => {
    const fake = startWatcher();

    await waitFor("the idle screen", () => fake.writes.length > 0);

    const before = fake.writes.length;
    fake.resize();

    expect(fake.writes.length).toBe(before + 1);
    expect(fake.writes[before]?.startsWith(CLEAR_SCREEN)).toBe(true);

    await finish(fake);
  });
});

describe("runWatch review handling", () => {
  test("a submitted review opens the TUI and a clean quit answers the hook", async () => {
    const fake = startWatcher();
    const order: string[] = [];
    const agent = await connectAgent(order, "a");

    agent.submit("a.ts");

    await waitFor("the TUI", () => altScreenCount(fake.writes) === 1);

    fake.feed(QUIT_KEY);

    await waitFor("the verdict", () => order.length === 1);

    const verdict = agent.received.find((message) => message.type === "verdict");

    expect(verdict).toBeDefined();
    expect(verdict?.type === "verdict" ? verdict.questions : null).toEqual([]);

    await finish(fake);
  });

  test("two queued reviews are answered in the order they were submitted", async () => {
    const fake = startWatcher();
    const order: string[] = [];

    const first = await connectAgent(order, "a");
    const second = await connectAgent(order, "b");

    first.submit("a.ts");
    await waitFor("the first TUI", () => altScreenCount(fake.writes) === 1);

    second.submit("b.ts");
    fake.feed(QUIT_KEY);

    await waitFor("the second TUI", () => altScreenCount(fake.writes) === 2);

    fake.feed(QUIT_KEY);
    await waitFor("both verdicts", () => order.length === 2);

    expect(order).toEqual(["a", "b"]);

    await finish(fake);
  });

  test("an agent that dies mid-review aborts the TUI and returns the watcher to idle", async () => {
    const fake = startWatcher();
    const order: string[] = [];
    const agent = await connectAgent(order, "a");

    agent.submit("a.ts");

    await waitFor("the TUI", () => altScreenCount(fake.writes) === 1);

    agent.socket.destroy();

    await waitFor("the TUI to leave", () => fake.writes.includes(ALT_SCREEN_OFF));
    await waitFor("the idle screen to come back", () => {
      const left = fake.writes.lastIndexOf(ALT_SCREEN_OFF);
      return fake.writes.slice(left).some((text) => text.startsWith(CLEAR_SCREEN));
    });

    expect(order).toEqual([]);
    expect(fake.cleanupCalls()).toBe(1);

    const code = await finish(fake);

    expect(code).toBe(0);
  });

  test("a review that sends notes leaves no result file behind", async () => {
    const before = resultFilesInTmp();
    const fake = startWatcher();
    const order: string[] = [];
    const agent = await connectAgent(order, "a");

    agent.submit("a.ts");

    await waitFor("the TUI", () => altScreenCount(fake.writes) === 1);

    fake.feed(SEND_KEY);

    await waitFor("the verdict", () => order.length === 1);
    await finish(fake);

    expect(resultFilesInTmp()).toEqual(before);
  });
});

describe("startWebWatch", () => {
  test("publishes the url file for the directory and removes it on close", async () => {
    watcher = await startWebWatch({ directory, port: 0, socketPath, token: TOKEN }, config);

    const urlPath = sessionUrlPath(directory);

    expect(existsSync(urlPath)).toBe(true);

    const published: unknown = JSON.parse(readFileSync(urlPath, "utf-8"));

    expect(isRecord(published) ? published["url"] : null).toBe(watcher.url);
    expect(isRecord(published) ? published["pid"] : null).toBe(process.pid);

    const current = watcher;
    watcher = null;
    await current.close();

    expect(existsSync(urlPath)).toBe(false);
  });

  test("reports the socket path it listened on and a real port", async () => {
    watcher = await startWebWatch({ directory, port: 0, socketPath, token: TOKEN }, config);

    expect(watcher.socketPath).toBe(socketPath);
    expect(watcher.port).toBeGreaterThan(0);
  });

  test("an agent that dies mid-review withdraws the offer from an open viewer", async () => {
    watcher = await startWebWatch({ directory, port: 0, socketPath, token: TOKEN }, config);

    const viewer = await openViewer(`${watcher.url}/events`);

    try {
      const order: string[] = [];
      const agent = await connectAgent(order, "a");

      agent.submit("a.ts");
      await viewer.until("event: review");

      agent.socket.destroy();

      expect(await viewer.until("event: cancel")).toContain("event: cancel");
    } finally {
      viewer.cancel();
    }
  });
});

describe("a second watcher on one session", () => {
  test("a watcher on a free socket binds it and writes the sidecar", async () => {
    const owner = startWatcher();

    await waitFor("the idle screen", () => owner.writes.length > 0);

    expect(existsSync(socketPath)).toBe(true);
    expect(existsSync(recordPathFor(socketPath))).toBe(true);

    await finish(owner);
  });

  test("a watcher on an owned socket attaches, and both watchers see the same review", async () => {
    const owner = startWatcher();

    await waitFor("the owner socket", () => existsSync(socketPath));

    const viewer = startWatcher();

    await waitFor("the viewer idle screen", () => viewer.writes.length > 0);

    const order: string[] = [];
    const agent = await connectAgent(order, "a");

    agent.submit("a.ts");

    await waitFor("the owner TUI", () => altScreenCount(owner.writes) === 1);
    await waitFor("the viewer TUI", () => altScreenCount(viewer.writes) === 1);

    owner.feed(QUIT_KEY);

    await waitFor("the verdict", () => order.length === 1);
    await waitFor("the viewer back at idle", () => viewer.cleanupCalls() === 1);

    await finish(viewer);
    await finish(owner);
  });

  test("a viewer leaves the socket and the sidecar behind when it quits", async () => {
    const owner = startWatcher();

    await waitFor("the owner socket", () => existsSync(socketPath));

    const viewer = startWatcher();

    await waitFor("the viewer idle screen", () => viewer.writes.length > 0);
    await finish(viewer);

    expect(existsSync(socketPath)).toBe(true);
    expect(existsSync(recordPathFor(socketPath))).toBe(true);

    await finish(owner);

    expect(existsSync(socketPath)).toBe(false);
    expect(existsSync(recordPathFor(socketPath))).toBe(false);
  });
});

describe("watching one session", () => {
  useShortStateHome();

  test("a session key decides the socket path", async () => {
    const key = sessionKey("d95655de-eb7f-45e5-867d-9797a355353e");
    const fake = makeFakeIo();

    running.set(fake, runWatch({ directory, sessionKey: key, io: fake.io }, config));

    await waitFor("the idle screen", () => fake.writes.length > 0);

    expect(existsSync(sessionKeySocketPath(key))).toBe(true);
    expect(existsSync(sessionSocketPath(directory))).toBe(false);

    await finish(fake);
  });
});
