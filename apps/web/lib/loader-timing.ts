// Per-page loader timing (#1193): each loader's duration in ms, plus the total since the timer started.
// Kept outside the page components so their render bodies stay pure (react-hooks/purity).

export interface LoaderTimer {
  /** Runs `run` and records its duration under `name`, whether it resolves or throws. */
  timed: <T>(name: string, run: () => Promise<T>) => Promise<T>;
  /** The recorded durations and the total so far, for one timing log line. */
  summary: () => { loaders: Record<string, number>; totalMs: number };
}

export function createLoaderTimer(): LoaderTimer {
  const loaders: Record<string, number> = {};
  const started = performance.now();
  return {
    async timed(name, run) {
      const start = performance.now();
      try {
        return await run();
      } finally {
        loaders[name] = Math.round(performance.now() - start);
      }
    },
    summary: () => ({ loaders, totalMs: Math.round(performance.now() - started) }),
  };
}
