// When a new service worker may take over (#50). A reload in the middle of a court day would throw
// away what a lawyer is looking at, so during the court-day windows (07:00-10:30 and 18:00-23:00
// IST) an update stays waiting and never forces a reload. Outside them it applies on the next
// navigation, and the toast offers "Update now". Pure: the clock is passed in.
const IST_OFFSET_MINUTES = 5.5 * 60;

/** Court-day windows in minutes after midnight IST: [start, end). */
export const COURT_DAY_WINDOWS: readonly (readonly [number, number])[] = [
  [7 * 60, 10 * 60 + 30],
  [18 * 60, 23 * 60],
];

function istMinutes(date: Date): number {
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (utcMinutes + IST_OFFSET_MINUTES) % (24 * 60);
}

export function inCourtDayWindow(date: Date): boolean {
  const minutes = istMinutes(date);
  return COURT_DAY_WINDOWS.some(([start, end]) => minutes >= start && minutes < end);
}

export interface UpdateDecision {
  /** Show "Update now" in the toast. Always false inside a court-day window. */
  offerUpdateNow: boolean;
  /** Let the waiting worker take over when the person next navigates. */
  applyOnNavigation: boolean;
}

export function updateDecision(date: Date): UpdateDecision {
  const quiet = !inCourtDayWindow(date);
  return { offerUpdateNow: quiet, applyOnNavigation: quiet };
}
