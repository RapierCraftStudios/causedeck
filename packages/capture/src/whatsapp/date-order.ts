// dd/mm vs mm/dd detection (#525). Exports are dd/mm by default; a first field above 12 proves
// dd/mm and a second field above 12 proves mm/dd. Anything else is a guess the UI can flip.
import type { DateOrder } from './types.ts';

export interface DateOrderDetection {
  order: DateOrder;
  /** No date settled it, or dates proved both orders. */
  ambiguous: boolean;
}

/** `pairs` are the first two numeric fields of every message date. */
export function detectDateOrder(
  pairs: readonly (readonly [number, number])[],
  fallback: DateOrder = 'dmy',
): DateOrderDetection {
  let dmy = false;
  let mdy = false;
  for (const [a, b] of pairs) {
    if (a > 12 && b <= 12) dmy = true;
    if (b > 12 && a <= 12) mdy = true;
  }
  if (dmy && !mdy) return { order: 'dmy', ambiguous: false };
  if (mdy && !dmy) return { order: 'mdy', ambiguous: false };
  return { order: fallback, ambiguous: true };
}
