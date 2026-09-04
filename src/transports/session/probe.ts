import { createConnection } from "node:net";
import { isString } from "../../helpers";
import { createLineReader, decodeLine, encode } from "./wire";
import type { SessionProbe } from "./probe.types";

const STATUS_TIMEOUT_MS = 250;

// Only these connect failures prove no listener owns the path. Any other error leaves the session alone.
const ABANDONED_CODES: string[] = ["ECONNREFUSED", "ENOENT", "ENOTSOCK", "ENOTDIR"];

// A watcher blocked past the timeout is still alive, so only a failed connect proves the socket is abandoned.
export function probeSession(socketPath: string): Promise<SessionProbe> {
  return new Promise((resolve) => {
    let settled = false;
    let connected = false;

    const settle = (probe: SessionProbe): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(probe);
    };

    const timer = setTimeout(() => settle({ status: "silent" }), STATUS_TIMEOUT_MS);

    const socket = createConnection(socketPath);
    socket.setEncoding("utf-8");

    const readLines = createLineReader();

    socket.on("error", (error: Error) => {
      const code = "code" in error ? error.code : null;
      const abandoned = !connected && isString(code) && ABANDONED_CODES.includes(code);

      settle(abandoned ? { status: "refused" } : { status: "silent" });
    });

    socket.on("close", () => settle({ status: "silent" }));

    socket.on("data", (chunk: string) => {
      readLines(chunk).forEach((line) => {
        const message = decodeLine(line);

        if (message?.type !== "state") {
          return;
        }

        settle({ status: "answered", state: message });
      });
    });

    socket.on("connect", () => {
      connected = true;
      socket.write(encode({ type: "status" }));
    });
  });
}
