import type { MultiplexerName } from "../core/config.types";
import type { Multiplexer } from "./multiplexer.types";
import { createZellijMultiplexer } from "./zellij";
import { createTmuxMultiplexer } from "./tmux";
import { createTtyMultiplexer } from "./tty";

export function detect(preference: MultiplexerName): Multiplexer {
  if (preference === "zellij") {
    return createZellijMultiplexer();
  }

  if (preference === "tmux") {
    return createTmuxMultiplexer();
  }

  if (preference === "none") {
    return createTtyMultiplexer();
  }

  const zellij = createZellijMultiplexer();

  if (zellij.available()) {
    return zellij;
  }

  const tmux = createTmuxMultiplexer();

  if (tmux.available()) {
    return tmux;
  }

  return createTtyMultiplexer();
}

export function describe(): string[] {
  const adapters: Multiplexer[] = [
    createZellijMultiplexer(),
    createTmuxMultiplexer(),
    createTtyMultiplexer(),
  ];

  return adapters.map((adapter) => `${adapter.name}: ${adapter.available() ? "available" : "not available"}`);
}
