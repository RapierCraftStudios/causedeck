// Expected timeline of a matter (#655, from #512, D-049, D-050): for each proceeding of a matter,
// the median listing delay and the median time to disposal of this workspace's own matters in the
// same forum and case type (and the same first-listing stage once the matter has been listed). It
// reads the caller's own workspace only, in its RLS transaction, and every figure is an aggregate:
// one with fewer than `MIN_CELL_SIZE` observations is withheld. No person-level dimension is read.
import { schema, type Database, type Transaction } from '@causedeck/db';
import { asc, eq } from 'drizzle-orm';

import {
  MIN_CELL_SIZE,
  UNLISTED_STAGE,
  daysBetween,
  loadCourtFacts,
  median,
  metric,
  type Metric,
  type ProceedingFact,
} from './index.ts';

type Db = Database | Transaction;

export interface ExpectedTimeline {
  forumId: string;
  caseTypeCode: string;
  /** The stage of the proceeding's first listing, or `UNLISTED_STAGE`. */
  stage: string;
  /** Whether the figures narrow to `stage` (a listed proceeding) or span every stage. */
  byStage: boolean;
  listingDelayDays: Metric;
  disposalDays: Metric;
  /** True when both figures are withheld. */
  withheld: boolean;
}

export interface MatterExpectedTimeline {
  /** The floor under which a figure is withheld, for the card to state. */
  minCell: number;
  forums: { id: string; court: string }[];
  timelines: ExpectedTimeline[];
}

export interface TimelineTarget {
  forumId: string;
  caseTypeCode: string;
  stage: string;
}

/** The expected timeline for one target over the workspace's facts. Pure. */
export function summariseExpectedTimeline(
  target: TimelineTarget,
  facts: readonly ProceedingFact[],
  minCell: number = MIN_CELL_SIZE,
): ExpectedTimeline {
  const byStage = target.stage !== UNLISTED_STAGE;
  const same = facts.filter(
    (f) =>
      f.forumId === target.forumId &&
      f.caseTypeCode === target.caseTypeCode &&
      (!byStage || f.stage === target.stage),
  );
  const delays = same
    .filter((f) => f.firstListedOn !== null)
    .map((f) => Math.max(0, daysBetween(f.filedOn, f.firstListedOn ?? f.filedOn)));
  const disposals = same
    .filter((f) => f.disposedOn !== null)
    .map((f) => Math.max(0, daysBetween(f.filedOn, f.disposedOn ?? f.filedOn)));
  const listingDelayDays = metric(delays, minCell, median);
  const disposalDays = metric(disposals, minCell, median);
  return {
    ...target,
    byStage,
    listingDelayDays,
    disposalDays,
    withheld: listingDelayDays.value === null && disposalDays.value === null,
  };
}

/** The expected timeline of each proceeding of the matter. Run it inside the workspace's RLS transaction. */
export async function getMatterExpectedTimeline(
  db: Db,
  matterId: string,
): Promise<MatterExpectedTimeline> {
  const { proceeding, listing, forum } = schema;
  const own = await db
    .select({
      id: proceeding.id,
      forumId: proceeding.forumId,
      caseTypeCode: proceeding.caseTypeCode,
    })
    .from(proceeding)
    .where(eq(proceeding.matterId, matterId));
  if (own.length === 0) return { minCell: MIN_CELL_SIZE, forums: [], timelines: [] };

  const listed = await db
    .select({ proceedingId: listing.proceedingId, stage: listing.stageNorm })
    .from(listing)
    .innerJoin(proceeding, eq(proceeding.id, listing.proceedingId))
    .where(eq(proceeding.matterId, matterId))
    .orderBy(asc(listing.listDate));
  const firstStage = new Map<string, string>();
  for (const row of listed) {
    if (!firstStage.has(row.proceedingId))
      firstStage.set(row.proceedingId, row.stage ?? UNLISTED_STAGE);
  }

  const pairs = new Map<string, { forumId: string; caseTypeCode: string }>();
  for (const p of own) pairs.set(`${p.forumId}|${p.caseTypeCode}`, p);
  const factsByPair = new Map<string, ProceedingFact[]>();
  for (const [key, pair] of pairs) {
    const { proceedings } = await loadCourtFacts(db, {
      from: '0001-01-01',
      to: '9999-12-31',
      forumId: pair.forumId,
      caseTypeCode: pair.caseTypeCode,
    });
    factsByPair.set(key, proceedings);
  }

  const timelines = own.map((p) =>
    summariseExpectedTimeline(
      {
        forumId: p.forumId,
        caseTypeCode: p.caseTypeCode,
        stage: firstStage.get(p.id) ?? UNLISTED_STAGE,
      },
      factsByPair.get(`${p.forumId}|${p.caseTypeCode}`) ?? [],
    ),
  );
  const forumIds = new Set(own.map((p) => p.forumId));
  const forumRows = await db.select({ id: forum.id, court: forum.court }).from(forum);
  return {
    minCell: MIN_CELL_SIZE,
    forums: forumRows.filter((f) => forumIds.has(f.id)),
    timelines,
  };
}
