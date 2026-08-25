import type { PairConfig } from "../core/config";
import type { ReviewTransport } from "./transport.types";
import type { PaneDeps } from "./pane";
import { createPaneTransport } from "./pane";
import { createSessionTransport } from "./session";

export function resolveTransport(config: PairConfig, deps: PaneDeps = {}): ReviewTransport {
  return config.transport === "session" ? createSessionTransport() : createPaneTransport(deps);
}

export { createPaneTransport, createSessionTransport };
export type { PaneDeps };
export type { EditRequest, ReviewOutcome, ReviewTransport } from "./transport.types";
