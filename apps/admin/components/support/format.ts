// Time formatting for the staff support pages (#314): 24-hour `HH:MM` in the app time zone, as the
// owner's banner shows it (`Support is viewing this workspace until 14:30`), and a `MM:SS` (or
// `H:MM:SS`) countdown. Pure, so server and client components share it.

/** The time zone the product shows times in (Indian practice). */
export const SUPPORT_TIME_ZONE = 'Asia/Kolkata';

const CLOCK = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: SUPPORT_TIME_ZONE,
});

const DATE_TIME = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: SUPPORT_TIME_ZONE,
});

/** `14:30`. */
export function clockTime(at: Date): string {
  return CLOCK.format(at);
}

/** `20 Oct, 14:30`, or an em dash when there is no time. */
export function dateTime(at: Date | null): string {
  return at === null ? '—' : DATE_TIME.format(at);
}

/** Time left as `MM:SS`, or `H:MM:SS` from an hour up; `00:00` once past. */
export function countdown(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${String(hours)}:${mm}:${ss}` : `${mm}:${ss}`;
}
