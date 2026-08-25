export interface IsolatedHomeOptions {
  // Names of extra variables to stash and unset for the duration of each test.
  clear?: readonly string[];
}

export interface IsolatedHome {
  readonly home: string;
  readonly stateHome: string;
  readonly configHome: string;
  tempDir(prefix: string): string;
}
