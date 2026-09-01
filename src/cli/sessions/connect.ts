import { listSessions } from "./sessions";
import type { ConnectResult, SessionListing } from "./sessions.types";
import type { WatchIo } from "../watch";

const CLEAR_SCREEN = "\x1b[2J\x1b[H";
const DOWN_KEYS = ["j", "\x1b[B"];
const UP_KEYS = ["k", "\x1b[A"];
const SELECT_KEYS = ["\r", "\n"];
// A bare escape byte can arrive split from the arrow sequence it opens, so escape never quits.
const QUIT_KEYS = ["q", "\x03"];
const HELP = "j/k move, Enter watches, q quits";

// A silent session answers no status, so its client count is unknown rather than zero.
function watchers(entry: SessionListing): string {
  return entry.clients === null ? "?" : String(entry.clients);
}

function paint(io: WatchIo, listings: SessionListing[], cursor: number): void {
  const rows = listings.map((entry, index) => {
    const marker = index === cursor ? ">" : " ";
    return `${marker} ${entry.id}  ${entry.label}  ${watchers(entry)} watching`;
  });

  io.write(`${CLEAR_SCREEN}pair mode sessions\r\n\r\n${rows.join("\r\n")}\r\n\r\n${HELP}\r\n`);
}

function pick(io: WatchIo, listings: SessionListing[]): Promise<ConnectResult> {
  return new Promise<ConnectResult>((resolve) => {
    let cursor = 0;

    io.onKey((key) => {
      if (QUIT_KEYS.includes(key)) {
        resolve({ selected: null, exitCode: 0 });
        return;
      }

      if (SELECT_KEYS.includes(key)) {
        resolve({ selected: listings[cursor]?.id ?? null, exitCode: 0 });
        return;
      }

      if (DOWN_KEYS.includes(key)) {
        cursor = Math.min(cursor + 1, listings.length - 1);
      }

      if (UP_KEYS.includes(key)) {
        cursor = Math.max(cursor - 1, 0);
      }

      paint(io, listings, cursor);
    });

    paint(io, listings, cursor);
  });
}

// The picker owns stdin for its whole run, so every exit path shuts the IO down before it resolves.
export async function runConnect(io: WatchIo): Promise<ConnectResult> {
  try {
    if (!io.isTty()) {
      io.write("connect needs a terminal; run pair-mode sessions instead\n");
      return { selected: null, exitCode: 1 };
    }

    const { listings } = await listSessions();

    if (listings.length === 0) {
      io.write("no pair-mode sessions\n");
      return { selected: null, exitCode: 0 };
    }

    return await pick(io, listings);
  } finally {
    io.shutdown();
  }
}
