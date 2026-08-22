import type { MultiplexerName } from "../core/config.types";
import type { DetectAdapters, Multiplexer } from "./multiplexer.types";
import { createZellijMultiplexer } from "./zellij";
import { createTmuxMultiplexer } from "./tmux";
import { createTtyMultiplexer } from "./tty";

export function detect(preference: MultiplexerName, adapters: DetectAdapters = {}): Multiplexer {
  const zellij = adapters.zellij ?? createZellijMultiplexer();
  const tmux = adapters.tmux ?? createTmuxMultiplexer();
  const tty = adapters.tty ?? createTtyMultiplexer();

  if (preference === "zellij") {
    return zellij;
  }

  if (preference === "tmux") {
    return tmux;
  }

  if (preference === "none") {
    return tty;
  }

  if (zellij.available()) {
    return zellij;
  }

  if (tmux.available()) {
    return tmux;
  }

  return tty;
}

export function describe(): string[] {
  const adapters: Multiplexer[] = [
    createZellijMultiplexer(),
    createTmuxMultiplexer(),
    createTtyMultiplexer(),
  ];

  return adapters.map((adapter) => `${adapter.name}: ${adapter.available() ? "available" : "not available"}`);
}
