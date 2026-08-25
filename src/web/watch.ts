import { createConnection } from "node:net";
import type { Socket } from "node:net";
import type { PairConfig } from "../core/config";
import { sessionSocketPath } from "../core/state";
import { startSessionServer } from "../transports/session";
import { createLineReader, decodeLine, encode } from "../transports/session";
import type { SessionServer } from "../transports/session";
import { toWebReview } from "./review";
import { startWebServer } from "./server";
import type { WebServer } from "./server.types";
import type { WebWatchOptions, WebWatcher } from "./watch.types";

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
  const socketPath = options.socketPath ?? sessionSocketPath(options.directory);
  const session: SessionServer = await startSessionServer({ socketPath });
  const client = await connectSelf(socketPath);

  const web: WebServer = await startWebServer({
    port: options.port,
    token: options.token,
    onVerdict(id, questions) {
      client.write(encode({ type: "verdict", id, questions }));
    },
  });

  const readLines = createLineReader();

  client.on("data", (chunk: string) => {
    readLines(chunk).forEach((line) => {
      const message = decodeLine(line);

      if (message?.type === "review") {
        void toWebReview(message, config).then((review) => web.offer(review));
        return;
      }

      if (message?.type === "cancel") {
        web.withdraw(message.id);
      }
    });
  });

  client.write(encode({ type: "attach", client: "web" }));

  return {
    url: web.url,
    socketPath,
    port: web.port,

    async close(): Promise<void> {
      client.destroy();
      await web.close();
      await session.close();
    },
  };
}
