import type { PairConfig } from "../core/config";
import type { ReviewTransport } from "./transport.types";
import type { PaneDeps } from "./pane";
import { createPaneTransport } from "./pane";

// The pane transport is the only one built, so config.transport has nothing to select on yet.
export function resolveTransport(_config: PairConfig, deps: PaneDeps = {}): ReviewTransport {
  return createPaneTransport(deps);
}

export { createPaneTransport };
export type { PaneDeps };
export type { EditRequest, ReviewOutcome, ReviewTransport } from "./transport.types";
