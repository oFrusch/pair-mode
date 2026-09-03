import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PairConfig } from "../core/config";
import { buildSessionRecord, watchSocketPath, watchUrlPath } from "../core/state";
import { ownerHost } from "../transports/session";
import type { SessionHost } from "../transports/session";
import { toWebReview } from "./review";
import { startWebServer } from "./server";
import type { WebServer } from "./server.types";
import type { WebWatchOptions, WebWatcher } from "./watch.types";
import { removeQuietly } from "../helpers";

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

// The web watcher needs no TTY, so a slash command can start it and print the link.
export async function startWebWatch(
  options: WebWatchOptions,
  config: PairConfig,
): Promise<WebWatcher> {
  const socketPath = watchSocketPath(options.directory, options.sessionKey, options.socketPath);
  const host: SessionHost = await ownerHost({
    socketPath,
    client: "web",
    record: buildSessionRecord(options, socketPath),
  });

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
  publishUrl(urlPath, web.url);

  return {
    url: web.url,
    socketPath,
    port: web.port,

    async close(): Promise<void> {
      removeQuietly(urlPath);
      await web.close();
      await host.close();
    },
  };
}
