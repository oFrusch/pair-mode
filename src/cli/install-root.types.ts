export interface EphemeralRoot {
  ephemeral: boolean;
  // The cache directory that would hold the hook targets, named so the message can quote it.
  cache: string | null;
}
