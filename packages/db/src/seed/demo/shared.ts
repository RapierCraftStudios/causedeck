// Shared helpers of the demo seed (#182): fixed ids, dates relative to the seed day, the seed
// instant and the provenance every demo fact carries.

/** The demo workspace (`organization.id`). */
export const DEMO_WORKSPACE_ID = '00000000-0000-4000-8000-d00000000001';

/** Every personal, party, firm and workspace name the demo seed writes ends with this. */
export const FICTIONAL_SUFFIX = ' (fictional)';

/** The id block of each row kind; the low part is a running number. */
export const ID_KIND = {
  user: 0x01,
  member: 0x02,
  forum: 0x10,
  hall: 0x11,
  bench: 0x12,
  matter: 0x20,
  person: 0x21,
  roleEdge: 0x22,
  proceeding: 0x23,
  proceedingLink: 0x24,
  document: 0x30,
  anchor: 0x31,
  order: 0x32,
  listing: 0x40,
  hearing: 0x41,
  obligation: 0x50,
  task: 0x51,
} as const;

/**
 * `00000000-0000-4000-8000-d<kind:2 hex><n:9 digits>`: a fixed, v4-shaped id. The `d` block keeps
 * the demo ids clear of the e2e seed's (`...-0000000a001`, `...-0000000b0101`, ...).
 */
export function demoId(kind: number, n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999_999_999)
    throw new RangeError(`demoId: bad n ${String(n)}`);
  return `00000000-0000-4000-8000-d${kind.toString(16).padStart(2, '0')}${String(n).padStart(9, '0')}`;
}

/** Today's date (`yyyy-mm-dd`) in Asia/Kolkata, where the demo's courts sit. */
export function kolkataToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** `date` (`yyyy-mm-dd`) plus `days` (may be negative). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The instant every demo row is stamped with: 09:00 IST on the seed day (no `now()` defaults). */
export function seedInstant(today: string): Date {
  return new Date(`${today}T09:00:00+05:30`);
}

/** Provenance of every demo fact: written by the system, from this seed, already confirmed. */
export function demoProvenance(at: Date) {
  return {
    sourceType: 'system' as const,
    sourceRef: 'seed:demo',
    confirmationState: 'confirmed' as const,
    capturedAt: at,
  };
}
