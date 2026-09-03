import { isRecord } from "../../helpers";
import type { Question } from "../../core/collect";
import type {
  AttachMessage,
  CancelMessage,
  ClientKind,
  LineReader,
  ReviewMessage,
  StateMessage,
  SubmitMessage,
  VerdictMessage,
  WireMessage,
} from "./wire.types";

const CLIENT_KINDS: string[] = ["tui", "web"];

export function encode(message: WireMessage): string {
  return JSON.stringify(message) + "\n";
}

// A socket chunk splits anywhere, so the tail of a chunk is held until its newline arrives.
export function createLineReader(): LineReader {
  let buffered = "";

  return (chunk: string): string[] => {
    const parts = (buffered + chunk).split("\n");
    buffered = parts.pop() ?? "";
    return parts.filter((line) => line.trim() !== "");
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isClientKind(value: unknown): value is ClientKind {
  return isString(value) && CLIENT_KINDS.includes(value);
}

function isQuestion(value: unknown): value is Question {
  if (!isRecord(value)) {
    return false;
  }

  const line = value["line"];
  const lineOk = line === null || typeof line === "number";

  return lineOk && isString(value["code"]) && isString(value["text"]);
}

function isQuestionList(value: unknown): value is Question[] {
  return Array.isArray(value) && value.every(isQuestion);
}

function toSubmit(raw: Record<string, unknown>): SubmitMessage | null {
  if (!isString(raw["tool"]) || !isString(raw["path"])) {
    return null;
  }

  if (!isString(raw["before"]) || !isString(raw["after"])) {
    return null;
  }

  return {
    type: "submit",
    tool: raw["tool"],
    path: raw["path"],
    before: raw["before"],
    after: raw["after"],
  };
}

function toAttach(raw: Record<string, unknown>): AttachMessage | null {
  return isClientKind(raw["client"]) ? { type: "attach", client: raw["client"] } : null;
}

function toReview(raw: Record<string, unknown>): ReviewMessage | null {
  const submit = toSubmit({ ...raw, type: "submit" });

  if (submit === null || !isString(raw["id"])) {
    return null;
  }

  return {
    type: "review",
    id: raw["id"],
    tool: submit.tool,
    path: submit.path,
    before: submit.before,
    after: submit.after,
  };
}

function toVerdict(raw: Record<string, unknown>): VerdictMessage | null {
  if (!isString(raw["id"]) || !isQuestionList(raw["questions"])) {
    return null;
  }

  return { type: "verdict", id: raw["id"], questions: raw["questions"] };
}

function toCancel(raw: Record<string, unknown>): CancelMessage | null {
  return isString(raw["id"]) ? { type: "cancel", id: raw["id"] } : null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toState(raw: Record<string, unknown>): StateMessage | null {
  const lastAttachAt = raw["lastAttachAt"];

  if (lastAttachAt !== null && !isString(lastAttachAt)) {
    return null;
  }

  if (!isNumber(raw["clientCount"]) || !isNumber(raw["waitingDepth"])) {
    return null;
  }

  return {
    type: "state",
    clientCount: raw["clientCount"],
    waitingDepth: raw["waitingDepth"],
    lastAttachAt,
  };
}

// A malformed line yields null rather than throwing, so one bad write never kills the socket.
export function decodeLine(line: string): WireMessage | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const type = parsed["type"];

  if (type === "submit") {
    return toSubmit(parsed);
  }

  if (type === "attach") {
    return toAttach(parsed);
  }

  if (type === "review") {
    return toReview(parsed);
  }

  if (type === "verdict") {
    return toVerdict(parsed);
  }

  if (type === "cancel") {
    return toCancel(parsed);
  }

  if (type === "status") {
    return { type: "status" };
  }

  if (type === "state") {
    return toState(parsed);
  }

  return null;
}
