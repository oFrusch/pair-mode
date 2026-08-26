export {
  backupIfPresent,
  isPreToolUseRegistered,
  claudeCodeSettingsPath,
  registerClaudeCode,
  codexHooksPath,
  registerCodex,
  findMultiEditMatchers,
  correctMultiEditMatchers,
  isReExportRegistered,
  opencodePluginPath,
  registerOpencode,
  piExtensionPath,
  piExtensionSource,
  registerPi,
} from "./register";

export {
  isPairCommandRegistered,
  pairCommandPath,
  pairCommandSource,
  registerPairCommand,
} from "./commands";

export type { CliName } from "./commands.types";
