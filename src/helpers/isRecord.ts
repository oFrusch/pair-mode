export function isRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
