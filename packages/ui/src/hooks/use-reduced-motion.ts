import { useMediaQuery } from './use-media-query';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** True when the user asked the OS to minimise motion. Pair with `src/lib/motion.ts` presets. */
export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}
