import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribe to a CSS media query. Returns `false` on the server and before hydration, so markup
 * rendered without the query (desktop-first, motion on) never mismatches.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => undefined;
      }
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    [query],
  );

  const getSnapshot = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
