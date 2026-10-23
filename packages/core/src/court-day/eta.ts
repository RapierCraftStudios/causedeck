// The call-time estimate (#493, D-048): the items ahead of a matter's item on a hall's board times
// the bench's pace, the median minutes per item learnt from the hall's own board history. The pace
// comes from consecutive board observations of one hall on one day while it was sitting; the window
// is the 25th to 75th percentile of that pace, so the answer is a range with a confidence level, never
// a promise. Pure: no clock, no database. `backtestEta` replays recorded observations and reports the
// median absolute error of the estimate in minutes.

export interface PaceObservation {
  itemNo: string | null;
  status: 'sitting' | 'risen' | 'passed_over' | 'lunch';
  observedAt: Date;
}

export type EtaConfidence = 'low' | 'medium' | 'high';

export interface CallWindow {
  from: Date;
  to: Date;
  /** Median minutes per item behind the window. */
  medianMinutesPerItem: number;
  confidence: EtaConfidence;
  samples: number;
}

/** A gap longer than this between two observations is a break, not a pace sample. */
const MAX_SAMPLE_MINUTES = 180;
const MIN_SAMPLES = { medium: 3, high: 8 };

const istDay = (at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at);

/** The numeric part of an item number (`14A` is 14); null for none. */
export function itemNumber(itemNo: string | null): number | null {
  if (itemNo === null) return null;
  const match = /^\d+/.exec(itemNo.trim());
  return match === null ? null : Number(match[0]);
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return (sorted[low] ?? 0) + ((sorted[high] ?? 0) - (sorted[low] ?? 0)) * (at - low);
}

const sortedCopy = (values: readonly number[]) => [...values].sort((a, b) => a - b);

/** Minutes per item between consecutive sitting observations of one hall, in time order. */
export function paceSamples(observations: readonly PaceObservation[]): number[] {
  const ordered = [...observations].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const samples: number[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const before = ordered[i - 1];
    const after = ordered[i];
    if (before === undefined || after === undefined) continue;
    if (before.status !== 'sitting' || after.status !== 'sitting') continue;
    if (istDay(before.observedAt) !== istDay(after.observedAt)) continue;
    const a = itemNumber(before.itemNo);
    const b = itemNumber(after.itemNo);
    if (a === null || b === null || b <= a) continue;
    const minutes = (after.observedAt.getTime() - before.observedAt.getTime()) / 60_000;
    if (minutes <= 0 || minutes > MAX_SAMPLE_MINUTES) continue;
    samples.push(minutes / (b - a));
  }
  return samples;
}

function confidenceOf(sorted: readonly number[]): EtaConfidence {
  if (sorted.length < MIN_SAMPLES.medium) return 'low';
  const median = quantile(sorted, 0.5);
  const spread = (quantile(sorted, 0.75) - quantile(sorted, 0.25)) / (median || 1);
  if (sorted.length >= MIN_SAMPLES.high && spread <= 0.5) return 'high';
  return spread <= 1 ? 'medium' : 'low';
}

/** The estimated call window `itemsAhead` items from now; null when the bench has no pace history. */
export function estimateCallWindow(input: {
  itemsAhead: number;
  samples: readonly number[];
  now: Date;
}): CallWindow | null {
  if (input.samples.length === 0 || input.itemsAhead < 0) return null;
  const sorted = sortedCopy(input.samples);
  const median = quantile(sorted, 0.5);
  const at = (minutes: number) => new Date(input.now.getTime() + minutes * 60_000);
  return {
    from: at(quantile(sorted, 0.25) * input.itemsAhead),
    to: at(quantile(sorted, 0.75) * input.itemsAhead),
    medianMinutesPerItem: median,
    confidence: confidenceOf(sorted),
    samples: sorted.length,
  };
}

/**
 * Replays one hall's recorded observations: at each sitting observation, estimate every later
 * observation of the same day from the pace seen up to then and compare the median estimate with the
 * actual minutes. Returns the median absolute error in minutes (null when nothing could be scored).
 */
export function backtestEta(observations: readonly PaceObservation[]): {
  scored: number;
  medianErrorMinutes: number | null;
} {
  const ordered = [...observations].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const errors: number[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const here = ordered[i];
    if (here === undefined || here.status !== 'sitting') continue;
    const a = itemNumber(here.itemNo);
    if (a === null) continue;
    const pace = paceSamples(ordered.slice(0, i + 1));
    if (pace.length === 0) continue;
    const median = quantile(sortedCopy(pace), 0.5);
    for (const later of ordered.slice(i + 1)) {
      if (istDay(later.observedAt) !== istDay(here.observedAt)) break;
      const b = itemNumber(later.itemNo);
      if (later.status !== 'sitting' || b === null || b <= a) continue;
      const actual = (later.observedAt.getTime() - here.observedAt.getTime()) / 60_000;
      errors.push(Math.abs(median * (b - a) - actual));
    }
  }
  if (errors.length === 0) return { scored: 0, medianErrorMinutes: null };
  return { scored: errors.length, medianErrorMinutes: quantile(sortedCopy(errors), 0.5) };
}
