// A file ending in a newline splits to a trailing empty element, which is not a real line.
export function splitLines(text: string): string[] {
  const lines = text.split("\n");
  const last = lines.at(-1);

  if (last === "") {
    lines.pop();
  }

  return lines;
}
