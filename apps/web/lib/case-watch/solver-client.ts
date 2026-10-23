// The page side of the captcha solver worker (#593). One worker per solver, created on first use;
// a solve that fails, times out or has no Worker support answers null so the caller uses the
// server fallback. Pattern of lib/inbox/whatsapp-import/worker-client.ts.
import type { CaptchaSolver, SolveRequest, SolveResponse } from './solver.types.ts';

export const SOLVE_TIMEOUT_MS = 20_000;

export function createCaptchaSolver(timeoutMs = SOLVE_TIMEOUT_MS): CaptchaSolver {
  let worker: Worker | null = null;
  let next = 0;

  const start = (): Worker | null => {
    if (typeof Worker === 'undefined') return null;
    worker ??= new Worker(new URL('../../workers/captcha-solver.worker.ts', import.meta.url), {
      type: 'module',
    });
    return worker;
  };

  return {
    solve(image) {
      const active = start();
      if (active === null) return Promise.resolve(null);
      const id = (next += 1);
      return new Promise<string | null>((resolve) => {
        const finish = (text: string | null) => {
          clearTimeout(timer);
          active.removeEventListener('message', onMessage);
          active.removeEventListener('error', onError);
          resolve(text);
        };
        const onMessage = (event: MessageEvent<SolveResponse>) => {
          if (event.data.id !== id) return;
          finish(event.data.type === 'text' ? event.data.text : null);
        };
        const onError = () => {
          finish(null);
        };
        const timer = setTimeout(() => {
          finish(null);
        }, timeoutMs);
        active.addEventListener('message', onMessage);
        active.addEventListener('error', onError);
        active.postMessage({ id, image } satisfies SolveRequest);
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
    },
  };
}
