import type { Layout, PaintLayout } from "./types";

// The TUI speaks "split" | "unified". PairConfig.layout speaks "split" | "inline", because "inline" already names the one-column layout there.
export function paintLayout(layout: Layout): PaintLayout {
  return layout === "inline" ? "unified" : "split";
}
