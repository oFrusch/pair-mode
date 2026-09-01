export {
  stateDir,
  flagPath,
  isEnabled,
  enable,
  disable,
  sessionsDir,
  sessionSocketPath,
  sessionUrlPath,
  findSessionSocket,
  resolveSocketPath,
  sessionKey,
  sessionKeySocketPath,
  sessionKeyFlagPath,
  sessionKeyOptOutPath,
  sessionKeyRecordPath,
  sessionKeyUrlPath,
  enableSession,
  optOutSession,
  sessionFlagState,
} from "./state";

export type { SessionKey, SessionKind, FlagState, SessionRecord } from "./state.types";
