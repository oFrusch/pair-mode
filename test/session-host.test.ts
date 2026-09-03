import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, beforeEach, afterEach } from "vitest";
import {
  ownerHost,
  viewerHost,
  createLineReader,
  decodeLine,
  encode,
} from "../src/transports/session";
import type { ReviewMessage, SessionHost, WireMessage } from "../src/transports/session";
import { useIsolatedHome } from "./helpers/env";

const isolated = useIsolatedHome();

const WAIT_TIMEOUT_MS = 2000;
const POLL_MS = 5;

let socketPath: string;
const hosts: SessionHost[] = [];
const openSockets: Socket[] = [];

beforeEach(() => {
  socketPath = join(isolated.tempDir("pair-host-"), "s.sock");
});

afterEach(async () => {
  for (const host of hosts.reverse()) {
    await host.close();
  }

  hosts.length = 0;
  openSockets.forEach((socket) => socket.destroy());
  openSockets.length = 0;
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }

    await sleep(POLL_MS);
  }

  throw new Error("condition never became true");
}

// An agent connection speaks the hook side of the wire, so a test can submit a real edit.
function connectAgent(): Promise<{ received: WireMessage[]; send(message: WireMessage): void }> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const received: WireMessage[] = [];
    const readLines = createLineReader();

    openSockets.push(socket);
    socket.setEncoding("utf-8");

    socket.on("data", (chunk: string) => {
      readLines(chunk).forEach((line) => {
        const message = decodeLine(line);

        if (message !== null) {
          received.push(message);
        }
      });
    });

    socket.once("error", reject);
    socket.once("connect", () =>
      resolve({ received, send: (message) => socket.write(encode(message)) }),
    );
  });
}

async function startOwner(): Promise<SessionHost> {
  const host = await ownerHost({ socketPath, client: "tui" });
  hosts.push(host);
  return host;
}

async function startViewer(): Promise<SessionHost> {
  const host = await viewerHost({ socketPath, client: "tui" });
  hosts.push(host);
  return host;
}

const SUBMIT: WireMessage = {
  type: "submit",
  tool: "edit",
  path: "/repo/a.ts",
  before: "a",
  after: "b",
};

test("an owner host binds the socket and reports its own counts", async () => {
  const owner = await startOwner();

  expect(owner.owns).toBe(true);
  expect(existsSync(socketPath)).toBe(true);
  await waitFor(() => owner.counts().clients === 1);
});

test("an owner host delivers a submitted review to its handler", async () => {
  const owner = await startOwner();
  const agent = await connectAgent();
  const seen: ReviewMessage[] = [];

  owner.onReview((review) => seen.push(review));
  agent.send(SUBMIT);

  await waitFor(() => seen.length === 1);
  expect(seen[0]?.path).toBe("/repo/a.ts");
});

test("a review that lands before the handler registers is still delivered", async () => {
  const owner = await startOwner();
  const agent = await connectAgent();

  agent.send(SUBMIT);

  // The review reaches the socket before any handler exists, so the host must hold it.
  await sleep(50);

  const seen: ReviewMessage[] = [];
  owner.onReview((review) => seen.push(review));

  await waitFor(() => seen.length === 1);
});

test("a viewer host attaches without binding and reports the owner's counts", async () => {
  const owner = await startOwner();
  const viewer = await startViewer();

  expect(viewer.owns).toBe(false);

  viewer.refreshCounts();
  await waitFor(() => viewer.counts().clients === 2);
  await waitFor(() => owner.counts().clients === 2);
});

test("a viewer verdict answers the agent and cancels the owner", async () => {
  const owner = await startOwner();
  const viewer = await startViewer();
  const agent = await connectAgent();

  const ownerReviews: ReviewMessage[] = [];
  const viewerReviews: ReviewMessage[] = [];
  const ownerCancels: string[] = [];

  owner.onReview((review) => ownerReviews.push(review));
  owner.onCancel((id) => ownerCancels.push(id));
  viewer.onReview((review) => viewerReviews.push(review));

  agent.send(SUBMIT);
  await waitFor(() => viewerReviews.length === 1 && ownerReviews.length === 1);

  const id = viewerReviews[0]?.id ?? "";
  viewer.verdict(id, []);

  await waitFor(() => ownerCancels.includes(id));
  await waitFor(() => agent.received.some((message) => message.type === "verdict"));
});

test("a viewer close leaves the socket for the owner", async () => {
  await startOwner();
  const viewer = await viewerHost({ socketPath, client: "tui" });

  await viewer.close();

  expect(existsSync(socketPath)).toBe(true);
});

test("an owner close removes the socket", async () => {
  const owner = await ownerHost({ socketPath, client: "tui" });
  await owner.close();

  expect(existsSync(socketPath)).toBe(false);
});

test("a repeated attach on one connection adds no second client", async () => {
  const owner = await startOwner();
  const extra = await connectAgent();

  extra.send({ type: "attach", client: "tui" });
  extra.send({ type: "attach", client: "tui" });

  await waitFor(() => owner.counts().clients === 2);
  await sleep(50);

  expect(owner.counts().clients).toBe(2);
});
