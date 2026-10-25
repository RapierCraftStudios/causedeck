// Court-day change freeze (#100). Pure: evaluates a clock reading in Asia/Kolkata, never client input.
// Windows are [start, end): 07:00:00-10:29:59 (morning court) and 18:00:00-22:59:59 (evening prepare).
// IST has no DST, but the wall clock still comes from Intl so the zone is explicit.

export interface FreezeWindow {
  readonly name: string;
  readonly startSecond: number;
  readonly endSecond: number;
}

export interface FreezeResult {
  readonly frozen: boolean;
  /** Name of the window we are in, or '' when open. */
  readonly windowName: string;
  /** When production deploys may resume; `now` (IST) when not frozen. */
  readonly nextOpenAtIst: string;
  /** Start of the next freeze window (IST), for planning warnings. */
  readonly nextFreezeAtIst: string;
  /** Seconds until the next freeze starts (0 while frozen). */
  readonly secondsUntilFreeze: number;
}

const HOUR = 3600;
const DAY = 24 * HOUR;

export const FREEZE_WINDOWS: readonly FreezeWindow[] = [
  { name: 'morning-court', startSecond: 7 * HOUR, endSecond: 10 * HOUR + 1800 },
  { name: 'evening-prepare', startSecond: 18 * HOUR, endSecond: 23 * HOUR },
];

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function istParts(at: Date): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(at)) parts[part.type] = part.value;
  return parts;
}

/** `2026-10-25 18:00 IST` */
export function formatIst(at: Date): string {
  const p = istParts(at);
  const f = (key: string): string => p[key] ?? '';
  return `${f('year')}-${f('month')}-${f('day')} ${f('hour')}:${f('minute')} IST`;
}

function secondOfDay(at: Date): number {
  const p = istParts(at);
  return Number(p.hour) * HOUR + Number(p.minute) * 60 + Number(p.second);
}

export function evaluateFreeze(now: Date): FreezeResult {
  const current = secondOfDay(now);
  // Whole-second instant so boundaries are exact whatever the milliseconds are.
  const base = now.getTime() - (((now.getTime() % 1000) + 1000) % 1000);
  const at = (deltaSeconds: number): Date => new Date(base + deltaSeconds * 1000);

  const active = FREEZE_WINDOWS.find((w) => current >= w.startSecond && current < w.endSecond);
  if (active) {
    return {
      frozen: true,
      windowName: active.name,
      nextOpenAtIst: formatIst(at(active.endSecond - current)),
      nextFreezeAtIst: formatIst(now),
      secondsUntilFreeze: 0,
    };
  }

  const upcoming = FREEZE_WINDOWS.find((w) => w.startSecond > current);
  const untilFreeze = upcoming
    ? upcoming.startSecond - current
    : DAY - current + (FREEZE_WINDOWS[0]?.startSecond ?? 0);
  return {
    frozen: false,
    windowName: '',
    nextOpenAtIst: formatIst(now),
    nextFreezeAtIst: formatIst(at(untilFreeze)),
    secondsUntilFreeze: untilFreeze,
  };
}
