import type { StateMessage } from "./wire.types";

// A refused connect proves no listener owns the socket. A silent one proves nothing, so only refused sweeps.
export type SessionProbe =
  | { status: "answered"; state: StateMessage }
  | { status: "refused" }
  | { status: "silent" };
