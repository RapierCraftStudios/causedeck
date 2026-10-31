// Shared helpers of the demo seed (#182): fixed ids, dates relative to the seed day, the seed
// instant and the provenance every demo fact carries.

/** Every personal, party, firm and workspace name the demo seed writes ends with this. */
export const FICTIONAL_SUFFIX = ' (fictional)';

/** The id block of each row kind; the low part is a running number. */
export const ID_KIND = {
  workspace: 0x00,
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
  obligationEvent: 0x52,
  defect: 0x53,
  certifiedCopy: 0x54,
  clientContact: 0x25,
  snapshot: 0x42,
  briefState: 0x43,
  marker: 0x44,
  appearance: 0x45,
  enquiry: 0x60,
  enquiryParty: 0x61,
  conflictResult: 0x62,
  handover: 0x70,
  matterView: 0x71,
  feeAgreement: 0x80,
  invoice: 0x81,
  invoiceLine: 0x82,
  payment: 0x83,
  ledger: 0x84,
  limRule: 0x90,
  limComp: 0x91,
  statusLink: 0xa0,
  outward: 0xa1,
  outwardVersion: 0xa2,
  template: 0xb0,
  draft: 0xb1,
  draftVersion: 0xb2,
  capture: 0xc0,
  proposal: 0xc1,
  notification: 0xc2,
  issueTag: 0xc3,
  researchNote: 0xc4,
  activity: 0xc5,
  rating: 0xd0,
  pulse: 0xd1,
  portfolio: 0xe0,
  portfolioCase: 0xe1,
  memory: 0xf0,
  memoryProposal: 0xf1,
  memoryUsage: 0xf2,
  // The global corpus and catalogue rows (workspace index 0; no workspace owns them) and the
  // workspace rows that point at them (#1070, #1071).
  judgment: 0xe2,
  judgmentSegment: 0xe3,
  judgmentTag: 0xe4,
  judgmentStatuteRef: 0xe5,
  judgmentCitationRef: 0xe6,
  newsItem: 0xe7,
  notice: 0xe8,
  noticeMatch: 0xe9,
  judgmentAlert: 0xea,
  subscription: 0xeb,
  saasInvoice: 0xec,
  saasInvoiceLine: 0xed,
  noticeVacation: 0xee,
} as const;

/** Each demo workspace owns a block of this many numbers per row kind (the ids never collide). */
export const WORKSPACE_ID_SPAN = 100_000_000;

/**
 * `00000000-0000-4000-8000-d<kind:2 hex><n:9 digits>`: a fixed, v4-shaped id. The `d` block keeps
 * the demo ids clear of the e2e seed's (`...-0000000a001`, `...-0000000b0101`, ...).
 */
export function demoId(kind: number, n: number, workspaceIndex = 0): string {
  if (!Number.isInteger(n) || n < 1 || n >= WORKSPACE_ID_SPAN)
    throw new RangeError(`demoId: bad n ${String(n)}`);
  if (!Number.isInteger(workspaceIndex) || workspaceIndex < 0 || workspaceIndex > 8)
    throw new RangeError(`demoId: bad workspace ${String(workspaceIndex)}`);
  const low = workspaceIndex * WORKSPACE_ID_SPAN + n;
  return `00000000-0000-4000-8000-d${kind.toString(16).padStart(2, '0')}${String(low).padStart(9, '0')}`;
}

/**
 * A small deterministic PRNG (mulberry32): the same seed always gives the same sequence, so the
 * generated matters, parties and dates are identical on every run and every machine.
 */
export function createPrng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

/** The reserved test domain every demo user and visitor address is at. */
export const DEMO_EMAIL_DOMAIN = 'demo.causedeck.test';

/** `visitor.<workspace>.<id>@demo.causedeck.test`: an ephemeral visitor of a demo workspace. */
export function visitorEmail(workspaceKey: string, visitorId: string): string {
  return `visitor.${workspaceKey}.${visitorId}@${DEMO_EMAIL_DOMAIN}`;
}

/** SQL `like` pattern of the visitors of one demo workspace. */
export function visitorEmailPattern(workspaceKey: string): string {
  return `visitor.${workspaceKey}.%@${DEMO_EMAIL_DOMAIN}`;
}
