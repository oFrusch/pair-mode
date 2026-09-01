import { loadConfig } from "../core/config";
import { runWatch } from "./watch";
import { startWebWatch } from "../web";
import type { WatchTarget } from "./watch-target.types";

// startWebWatch always binds its own socket, so a run that joins a session another watcher owns stays in the terminal.
export function usesWebWatcher(target: WatchTarget, webEnabled: boolean): boolean {
  if (target.terminalOnly === true) {
    return false;
  }

  return target.web || webEnabled;
}

// Both `watch` and `connect` end here, so the terminal pane and the web watcher are started in one place.
export async function watchSession(target: WatchTarget): Promise<number> {
  const { directory, sessionKey, socketPath } = target;
  const { config, errors } = loadConfig();

  errors.forEach((error) => console.error(`config ${error.path}: ${error.message}`));

  if (!usesWebWatcher(target, config.web.enabled)) {
    // runWatch builds its own IO, so the picker's shut-down instance is never reused here.
    return await runWatch({ directory, sessionKey, socketPath }, config);
  }

  const watcher = await startWebWatch(
    { directory, sessionKey, socketPath, port: config.web.port },
    config,
  );

  console.log(`pair mode is watching ${directory}`);
  console.log(watcher.url);

  // The web watcher has no TTY loop of its own, so the process stays alive until a signal stops it.
  await new Promise<void>((done) => {
    const stop = (): void => {
      void watcher.close().then(done);
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  return 0;
}
