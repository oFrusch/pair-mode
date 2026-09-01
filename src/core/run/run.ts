import type { PairConfig } from "../config";
import type { EditRequest, RunDeps, RunVerdict } from "./types";
import { isEnabled, sessionKey } from "../state";
import { formatQuestions } from "../collect";
import { resolveTransport } from "../../transports";

export async function runPair(
  request: EditRequest,
  config: PairConfig,
  deps: RunDeps = {},
): Promise<RunVerdict> {
  if (request.before === request.after) {
    return { decision: "allow", reviewed: false };
  }

  const key = request.sessionId === undefined ? undefined : sessionKey(request.sessionId);

  if (!isEnabled(request.filePath, key)) {
    return { decision: "allow", reviewed: false };
  }

  const transport = deps.transport ?? resolveTransport(config, deps);
  const outcome = await transport.review(request, config);

  if (!outcome.reviewed) {
    return { decision: "allow", reviewed: false, reason: outcome.detail };
  }

  if (outcome.questions.length === 0) {
    return { decision: "allow", reviewed: true };
  }

  return { decision: "deny", reason: formatQuestions(outcome.questions, request.filePath) };
}
