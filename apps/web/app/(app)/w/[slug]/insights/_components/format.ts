// Small pure helpers of the practice insights screens (#85): percentages and the delta wording.

/** A rate as a whole percent. */
export const percent = (rate: number): number => Math.round(rate * 100);

/** A weekly rate list as `61, 70, 78` for the text summary of the trend. */
export const rateList = (rates: readonly (number | null)[]): string =>
  rates
    .filter((r): r is number => r !== null)
    .map((r) => String(percent(r)))
    .join(', ');

/** Below this many decided appearances the figure is labelled a small sample. */
export const SMALL_SAMPLE = 10;

export type DeltaKey = 'delta.up' | 'delta.down' | 'delta.flat' | 'delta.none';

/** The message key and value for a change against the baseline. Never colour alone: sign and arrow. */
export function deltaOf(delta: number | null): {
  key: DeltaKey;
  value: string;
  direction: 'up' | 'down' | 'flat' | 'none';
} {
  if (delta === null) return { key: 'delta.none', value: '', direction: 'none' };
  if (delta === 0) return { key: 'delta.flat', value: '', direction: 'flat' };
  return {
    key: delta > 0 ? 'delta.up' : 'delta.down',
    value: Math.abs(delta).toFixed(1),
    direction: delta > 0 ? 'up' : 'down',
  };
}
