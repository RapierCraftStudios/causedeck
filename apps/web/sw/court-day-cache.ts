// The court-day half of the service worker (#65 part 3), kept apart from `app/sw.ts` so it is
// unit-tested. The worker never stores a signed-in response: when the network fails for `/today`,
// `/tomorrow` or a brief, it answers with the precached, data-free shell, and the page reads the
// encrypted store on the device. Prefetch needs the session secret, which only a page holds, so the
// Background Sync handler asks an open page to run it.
import { isOfflineShellNavigation, OFFLINE_SHELL_PATH } from '../lib/pwa/cache-policy.ts';

/** Background Sync tag for the 7-day prefetch (the outbox has its own, #745). */
export const PREFETCH_SYNC_TAG = 'causedeck-court-day-prefetch';
export const PREFETCH_MESSAGE = 'COURT_DAY_PREFETCH';

/** Fallback entry for the Serwist `fallbacks` list; it must come before the generic `/offline`. */
export const courtDayFallback = {
  url: OFFLINE_SHELL_PATH,
  matcher: ({ request, url }: { request: Request; url: URL }) =>
    isOfflineShellNavigation(request, url),
};

interface ClientLike {
  postMessage(message: unknown): void;
}
interface ClientsLike {
  matchAll(options: {
    type: 'window';
    includeUncontrolled: boolean;
  }): Promise<readonly ClientLike[]>;
}

/** Ask every open window to prefetch; resolves to how many were asked (0: try again later). */
export async function requestPrefetch(clients: ClientsLike): Promise<number> {
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) client.postMessage({ type: PREFETCH_MESSAGE });
  return windows.length;
}
