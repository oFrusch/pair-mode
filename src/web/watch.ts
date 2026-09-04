import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PairConfig } from "../core/config";
import { buildSessionRecord, watchSocketPath, watchUrlPath } from "../core/state";
import { ownerHost, probeSession, viewerHost } from "../transports/session";
import type { SessionHost } from "../transports/session";
import { toWebReview } from "./review";
import { startWebServer } from "./server";
import type { WebServer } from "./server.types";
import type { WebWatchOptions, WebWatcher } from "./watch.types";
import { isRecord, removeQuietly } from "../helpers";

const OWNER_ONLY_DIR = 0o700;
const OWNER_ONLY_FILE = 0o600;

// pair-mode on spawns this watcher detached, so the link and the process id reach the parent through a file.
function publishUrl(path: string, url: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: OWNER_ONLY_DIR });
  writeFileSync(path, JSON.stringify({ url, pid: process.pid }) + "\n", {
    encoding: "utf-8",
    mode: OWNER_ONLY_FILE,
  });
}

// A second web watcher must never take down the link the first one published, so the pid decides who owns the file.
function linkPid(path: string): number | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));

    return isRecord(parsed) && typeof parsed["pid"] === "number" ? parsed["pid"] : null;
  } catch {
    return null;
  }
}

// The web watcher needs no TTY, so a slash command can start it and print the link.
export async function startWebWatch(
  options: WebWatchOptions,
  config: PairConfig,
): Promise<WebWatcher> {
  const socketPath = watchSocketPath(options.directory, options.sessionKey, options.socketPath);

  // Only a refused connect proves no watcher owns this socket, so anything else means this tab is a second viewer.
  const owns = (await probeSession(socketPath)).status === "refused";

  const host: SessionHost = owns
    ? await ownerHost({
        socketPath,
        client: "web",
        record: buildSessionRecord(options, socketPath),
      })
    : await viewerHost({ socketPath, client: "web" });

  // Rendering awaits shiki, so a cancel can land mid-render and the finished review must not be offered.
  const ownedIds = new Set<string>();

  const web: WebServer = await startWebServer({
    port: options.port,
    token: options.token,
    layout: config.layout,
    onVerdict(id, questions) {
      ownedIds.delete(id);
      host.verdict(id, questions);
    },
  });

  host.onReview((message) => {
    const id = message.id;
    ownedIds.add(id);

    // A render that throws would otherwise become an unhandled rejection and kill the watcher.
    void toWebReview(message, config)
      .then((review) => {
        if (ownedIds.has(id)) {
          web.offer(review);
        }
      })
      .catch(() => {
        if (ownedIds.delete(id)) {
          host.verdict(id, []);
        }
      });
  });

  host.onCancel((id) => {
    ownedIds.delete(id);
    web.withdraw(id);
  });

  const urlPath = watchUrlPath(options.directory, options.sessionKey);

  // A viewer publishes its link only when nothing else has, so `pair-mode off` still finds the first watcher.
  const published = owns || !existsSync(urlPath);

  if (published) {
    publishUrl(urlPath, web.url);
  }

  return {
    url: web.url,
    socketPath,
    port: web.port,
    owns,

    async close(): Promise<void> {
      if (published && linkPid(urlPath) === process.pid) {
        removeQuietly(urlPath);
      }

      await web.close();
      await host.close();
    },
  };
}
