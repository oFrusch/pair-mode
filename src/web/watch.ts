import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PairConfig } from "../core/config";
import { sessionKeySocketPath, sessionSocketPath, sessionUrlPath } from "../core/state";
import { startSessionServer } from "../transports/session";
import { createLineReader, decodeLine, encode } from "../transports/session";
import type { SessionServer } from "../transports/session";
import { toWebReview } from "./review";
import { startWebServer } from "./server";
import type { WebServer } from "./server.types";
import type { WebWatchOptions, WebWatcher } from "./watch.types";
import { removeQuietly } from "../helpers";

// pair-mode on spawns this watcher detached, so the link and the process id reach the parent through a file.
function publishUrl(path: string, url: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ url, pid: process.pid }) + "\n", "utf-8");
}

function connectSelf(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.setEncoding("utf-8");
    socket.once("error", reject);
    socket.once("connect", () => resolve(socket));
  });
}

// The web watcher needs no TTY, so a slash command can start it and print the link.
export async function startWebWatch(
  options: WebWatchOptions,
  config: PairConfig,
): Promise<WebWatcher> {
  const socketPath =
    options.socketPath ??
    (options.sessionKey === undefined
      ? sessionSocketPath(options.directory)
      : sessionKeySocketPath(options.sessionKey));
  const session: SessionServer = await startSessionServer({ socketPath });
  const client = await connectSelf(socketPath);

  // Rendering awaits shiki, so a cancel can land mid-render and the finished review must not be offered.
  const ownedIds = new Set<string>();

  const web: WebServer = await startWebServer({
    port: options.port,
    token: options.token,
    layout: config.layout,
    onVerdict(id, questions) {
      ownedIds.delete(id);
      client.write(encode({ type: "verdict", id, questions }));
    },
  });

  const readLines = createLineReader();

  client.on("data", (chunk: string) => {
    readLines(chunk).forEach((line) => {
      const message = decodeLine(line);

      if (message?.type === "review") {
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
              client.write(encode({ type: "verdict", id, questions: [] }));
            }
          });
        return;
      }

      if (message?.type === "cancel") {
        ownedIds.delete(message.id);
        web.withdraw(message.id);
      }
    });
  });

  const urlPath = sessionUrlPath(options.directory);
  publishUrl(urlPath, web.url);

  client.write(encode({ type: "attach", client: "web" }));

  return {
    url: web.url,
    socketPath,
    port: web.port,

    async close(): Promise<void> {
      removeQuietly(urlPath);
      client.destroy();
      await web.close();
      await session.close();
    },
  };
}
