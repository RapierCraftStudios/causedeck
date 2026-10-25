// The page's data states, as a pure function of one fetch so every branch is testable in node.
import { STALE_AFTER_SEC, type StatusSnapshot } from './model.ts';
import { verifySnapshot } from './verify.ts';

export type StatusState =
  | { kind: 'ok'; snapshot: StatusSnapshot }
  | { kind: 'empty'; snapshot: StatusSnapshot }
  | { kind: 'stale'; snapshot: StatusSnapshot; ageSec: number }
  | { kind: 'unverified' }
  | { kind: 'unavailable' };

export type FetchLike = (url: string, init?: { cache?: 'no-store' }) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

export function ageSec(snapshot: Pick<StatusSnapshot, 'generatedAt'>, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(snapshot.generatedAt)) / 1000);
}

/** Fetch, verify and classify `status.json`. Never throws. */
export async function loadStatus(
  fetchFn: FetchLike,
  url: string,
  key: string,
  now: Date,
): Promise<StatusState> {
  let raw: unknown;
  try {
    const response = await fetchFn(url, { cache: 'no-store' });
    if (!response.ok) return { kind: 'unavailable' };
    raw = await response.json();
  } catch {
    return { kind: 'unavailable' };
  }
  const snapshot = await verifySnapshot(raw, key).catch(() => null);
  if (snapshot === null) return { kind: 'unverified' };
  const age = ageSec(snapshot, now);
  // An unreadable or future date cannot be shown as fresh.
  if (Number.isNaN(age) || age > STALE_AFTER_SEC) {
    return { kind: 'stale', snapshot, ageSec: age };
  }
  const quiet = snapshot.incidents.every((i) => i.resolvedAt !== null);
  return snapshot.overall === 'operational' && quiet && snapshot.components.length > 0
    ? { kind: 'empty', snapshot }
    : { kind: 'ok', snapshot };
}
