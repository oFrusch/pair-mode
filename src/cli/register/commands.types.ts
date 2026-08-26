import type { CliName } from "../detect/types";

export type { CliName };

export interface CommandSpec {
  // The path is relative to the home directory, in segments, so join builds it per platform.
  segments: string[];
  frontMatter: string[];
  // Each CLI names its own write tools, and the body tells the agent which calls pair mode holds.
  tools: string;
  // A slash command substitutes $ARGUMENTS; a pi skill has no argument placeholder.
  invocation: string;
}
