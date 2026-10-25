// Quiet hours (#196, #23 design): the `Do not push during court hours` setting makes 10:30-17:00
// in the member's local time quiet. Scheduled sends (the daily digest, and push from #197) check
// `isQuietTime` and do not send inside a quiet window. Pure and client-safe: no database imports.

/** Court hours, local time, `HH:MM`. */
export const COURT_HOURS = { start: '10:30', end: '17:00' } as const;

/** A member's quiet-hours setting (`notification_setting`); absent means no quiet hours. */
export interface QuietSetting {
  courtHoursQuiet: boolean;
}

function minutesOf(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** True when `localMinutesOfDay` (0-1439) falls inside the member's quiet hours. */
export function isQuietTime(localMinutesOfDay: number, setting: QuietSetting | undefined): boolean {
  if (setting?.courtHoursQuiet !== true) return false;
  return (
    localMinutesOfDay >= minutesOf(COURT_HOURS.start) &&
    localMinutesOfDay < minutesOf(COURT_HOURS.end)
  );
}

/** Minutes since local midnight of `date` in `timeZone` (an IANA zone). */
export function localMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return value('hour') * 60 + value('minute');
}
