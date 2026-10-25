// Cross-checked facts (#499, D-026, D-048): a fact such as a next date can come from up to three
// independent places (a fetched page, a shared document, a voice-note outcome). `assessAgreement`
// compares what each source says and returns the sources, an agreement status (`agree`, `conflict`,
// `single`) and a confidence score. It is pure and never chooses between two sources: a conflict
// is shown to a person, who resolves it (the matter-graph `chooseNextDateSource`, which keeps the
// losing proposal as `corrected` history).
//
// - Observations of the same source (same type and reference) count once, newest first.
// - Sources that say the same value are one group. Their confidence is combined as independent
//   evidence, `1 - Π(1 - c)`, so every agreeing source raises it; a source without a confidence
//   counts as `UNKNOWN_CONFIDENCE`.
// - With one group the status is `agree` (two sources or more) or `single`. With several groups it
//   is `conflict`, and the confidence of the leading group is discounted by the rival groups'.
import { schema, type Queryable } from '@causedeck/db';
import { and, eq, or, sql } from 'drizzle-orm';

const { listing } = schema;

/** What a source without a stored confidence is worth. */
export const UNKNOWN_CONFIDENCE = 0.5;

export type AgreementStatus = 'agree' | 'conflict' | 'single';

/** One source's reading of a fact. */
export interface FactObservation {
  sourceType: string;
  sourceRef: string | null;
  /** The value as a comparable string (a `YYYY-MM-DD` date, a normalised stage). */
  value: string;
  /** 0..1 or null when the source states none. */
  confidence: number | null;
}

export interface AgreementSource {
  sourceType: string;
  sourceRef: string | null;
  value: string;
  confidence: number | null;
}

export interface Agreement {
  status: AgreementStatus;
  /** Every distinct source, leading value group first. */
  sources: AgreementSource[];
  /** The value the leading group states; null without observations. */
  value: string | null;
  /** 0..1, three decimals. */
  confidence: number;
  /** The distinct values with the sources that state each (more than one only on a conflict). */
  groups: { value: string; sources: AgreementSource[]; confidence: number }[];
}

const round = (n: number): number => Math.round(n * 1000) / 1000;
const clamp = (n: number): number => Math.min(1, Math.max(0, n));
const weight = (s: { confidence: number | null }): number =>
  clamp(s.confidence ?? UNKNOWN_CONFIDENCE);

/** `1 - Π(1 - c)`: independent sources that agree raise one another's confidence. */
function combined(sources: readonly { confidence: number | null }[]): number {
  return 1 - sources.reduce((rest, s) => rest * (1 - weight(s)), 1);
}

/** Compare the observations of one fact. The caller passes them newest first. */
export function assessAgreement(observations: readonly FactObservation[]): Agreement {
  const seen = new Set<string>();
  const sources: AgreementSource[] = [];
  for (const o of observations) {
    const key = `${o.sourceType}\u0000${o.sourceRef ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      sourceType: o.sourceType,
      sourceRef: o.sourceRef,
      value: o.value,
      confidence: o.confidence,
    });
  }
  if (sources.length === 0) {
    return { status: 'single', sources: [], value: null, confidence: 0, groups: [] };
  }
  const byValue = new Map<string, AgreementSource[]>();
  for (const s of sources) byValue.set(s.value, [...(byValue.get(s.value) ?? []), s]);
  const groups = [...byValue.entries()]
    .map(([value, members]) => ({ value, sources: members, confidence: combined(members) }))
    .sort((a, b) => b.confidence - a.confidence || a.value.localeCompare(b.value));
  const [lead, ...rivals] = groups;
  if (lead === undefined) throw new Error('unreachable: no group for a non-empty source list');
  const rivalConfidence = rivals.length === 0 ? 0 : combined(rivals.flatMap((g) => g.sources));
  const confidence = round(clamp(lead.confidence * (1 - rivalConfidence)));
  return {
    status: rivals.length > 0 ? 'conflict' : lead.sources.length > 1 ? 'agree' : 'single',
    sources: groups.flatMap((g) => g.sources),
    value: lead.value,
    confidence,
    groups: groups.map((g) => ({ ...g, confidence: round(g.confidence) })),
  };
}

type ListingReading = {
  canonical: boolean;
  date: string;
  stage: string;
  sourceType: string;
  sourceRef: string | null;
  confidence: string | null;
  capturedAt: Date;
};

/**
 * The proceeding's canonical listing and its still-open proposals (`proposed`, not yet resolved by a
 * person), canonical first and then newest first, as observations of `pick(reading)`. A listing a
 * person fixed (`corrected`) is history and not a source. `db` must be a workspace-scoped
 * transaction (RLS).
 */
async function listingAgreement(
  db: Queryable,
  workspaceId: string,
  proceedingId: string,
  pick: (reading: ListingReading) => string,
): Promise<Agreement> {
  const rows: ListingReading[] = await db
    .select({
      canonical: listing.canonical,
      date: listing.listDate,
      stage: sql<string>`lower(btrim(coalesce(${listing.stageNorm}, ${listing.stageRaw})))`,
      sourceType: listing.sourceType,
      sourceRef: listing.sourceRef,
      confidence: listing.confidence,
      capturedAt: listing.capturedAt,
    })
    .from(listing)
    .where(
      and(
        eq(listing.workspaceId, workspaceId),
        eq(listing.proceedingId, proceedingId),
        or(eq(listing.canonical, true), eq(listing.confirmationState, 'proposed')),
      ),
    );
  rows.sort(
    (a, b) =>
      Number(b.canonical) - Number(a.canonical) || b.capturedAt.getTime() - a.capturedAt.getTime(),
  );
  return assessAgreement(
    rows.map((r) => {
      const confidence = r.confidence === null ? Number.NaN : Number(r.confidence);
      return {
        sourceType: r.sourceType,
        sourceRef: r.sourceRef,
        value: pick(r),
        confidence: Number.isNaN(confidence) ? null : confidence,
      };
    }),
  );
}

/** The agreement on a proceeding's next date (a `YYYY-MM-DD` value per source). */
export function getNextDateAgreement(
  db: Queryable,
  workspaceId: string,
  proceedingId: string,
): Promise<Agreement> {
  return listingAgreement(db, workspaceId, proceedingId, (r) => r.date);
}

/** The agreement on a proceeding's stage (the normalised stage, else the printed one, lowercased). */
export function getStageAgreement(
  db: Queryable,
  workspaceId: string,
  proceedingId: string,
): Promise<Agreement> {
  return listingAgreement(db, workspaceId, proceedingId, (r) => r.stage);
}
