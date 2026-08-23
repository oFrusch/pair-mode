import type { KeyEvent } from "./input.types";

const ESC = "\x1b";
const CSI_FINAL_START = 0x40;
const CSI_FINAL_END = 0x7e;
const CSI_PARAM_START = 0x20;
const CSI_PARAM_END = 0x3f;

const ARROW_NAMES: Record<string, string> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
};

const CTRL_NAMES: Record<string, string> = {
  "\x04": "d",
  "\x15": "u",
  "\x13": "s",
  "\x11": "q",
  "\x03": "c",
};

function consumeMouseSequence(chunk: string, start: number): number {
  const closeIndex = chunk.slice(start).search(/[Mm]/);

  if (closeIndex === -1) {
    return chunk.length;
  }

  return start + closeIndex + 1;
}

function consumeUnknownCsi(chunk: string, start: number): number {
  let index = start;

  while (index < chunk.length) {
    const code = chunk.charCodeAt(index);

    if (code >= CSI_FINAL_START && code <= CSI_FINAL_END) {
      return index + 1;
    }

    if (code < CSI_PARAM_START || code > CSI_PARAM_END) {
      return index;
    }

    index += 1;
  }

  return index;
}

function parseEscape(chunk: string, index: number): { event: KeyEvent | null; next: number } {
  const afterEsc = index + 1;

  if (afterEsc >= chunk.length || chunk[afterEsc] !== "[") {
    return { event: { name: "escape", ctrl: false, text: "" }, next: afterEsc };
  }

  const afterBracket = afterEsc + 1;
  const marker = afterBracket < chunk.length ? chunk[afterBracket] : undefined;

  if (marker === "<") {
    return { event: null, next: consumeMouseSequence(chunk, afterBracket + 1) };
  }

  if (marker !== undefined && marker in ARROW_NAMES) {
    return { event: { name: ARROW_NAMES[marker]!, ctrl: false, text: "" }, next: afterBracket + 1 };
  }

  return { event: null, next: consumeUnknownCsi(chunk, afterBracket) };
}

function parseSingle(chunk: string, index: number): { event: KeyEvent; next: number } {
  const char = chunk[index]!;
  const next = index + 1;

  if (char === "\r" || char === "\n") {
    return { event: { name: "enter", ctrl: false, text: "" }, next };
  }

  if (char === "\x7f" || char === "\b") {
    return { event: { name: "backspace", ctrl: false, text: "" }, next };
  }

  if (char === "\t") {
    return { event: { name: "tab", ctrl: false, text: "" }, next };
  }

  const ctrlName = CTRL_NAMES[char];

  if (ctrlName !== undefined) {
    return { event: { name: ctrlName, ctrl: true, text: "" }, next };
  }

  return { event: { name: char, ctrl: false, text: char }, next };
}

export function parseKeys(chunk: string): KeyEvent[] {
  const events: KeyEvent[] = [];
  let index = 0;

  while (index < chunk.length) {
    if (chunk[index] === ESC) {
      const result = parseEscape(chunk, index);

      if (result.event !== null) {
        events.push(result.event);
      }

      index = result.next;
      continue;
    }

    const result = parseSingle(chunk, index);

    events.push(result.event);
    index = result.next;
  }

  return events;
}
