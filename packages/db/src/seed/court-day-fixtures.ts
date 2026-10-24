// The synthetic chamber for the court day (#58): about 40 listings across a Madras High Court and a
// Karnataka High Court complex on one date, fictional parties only, for tests, the perf budget and
// stories. It writes into one workspace on a transaction already scoped to it (as the other seeders
// do) and never runs in production. Ids are random; codes and usage-style values are slug-safe (no
// UUID hyphens).
import { randomUUID } from 'node:crypto';

import type { Transaction } from '../client.ts';
import { courtHall, forum } from '../schema/court.ts';
import { listing } from '../schema/docket.ts';
import { matter } from '../schema/matter-graph.ts';
import { proceeding } from '../schema/proceedings.ts';

export const COURT_DAY_FIXTURE_LISTINGS = 40;

const PETITIONERS = ['Asha Traders', 'Kavya Textiles', 'Meera Foods', 'Nila Estates', 'Ravi Mills'];
const RESPONDENTS = ['State of Fictionia', 'Union of Utopia', 'Sunrise Bank', 'Greenfield Board'];
const STAGES = ['FOR ADMISSION', 'FOR ORDERS', 'FOR HEARING', 'FOR FINAL DISPOSAL'];

export interface CourtDayFixture {
  forumIds: { madras: string; karnataka: string };
  hallIds: string[];
  matterIds: string[];
  proceedingIds: string[];
  listingIds: string[];
}

export interface CourtDayFixtureOptions {
  workspaceId: string;
  /** The member who owns every fixture matter. */
  ownerMemberId: string;
  /** The court day (`yyyy-mm-dd`). */
  date: string;
}

/** Insert the chamber: 2 forums, 4 halls, 20 matters and 40 listings, two per matter. */
export async function insertCourtDayFixture(
  tx: Transaction,
  { workspaceId, ownerMemberId, date }: CourtDayFixtureOptions,
): Promise<CourtDayFixture> {
  const tag = randomUUID().replaceAll('-', '').slice(0, 10);
  const forums = await tx
    .insert(forum)
    .values([
      {
        workspaceId,
        code: `seed.in.tn.madras-hc.${tag}`,
        court: 'High Court of Madras',
        seat: 'Chennai',
        jurisdictionKind: 'high_court' as const,
      },
      {
        workspaceId,
        code: `seed.in.ka.karnataka-hc.${tag}`,
        court: 'High Court of Karnataka',
        seat: 'Bengaluru',
        jurisdictionKind: 'high_court' as const,
      },
    ])
    .returning({ id: forum.id });
  const [madras, karnataka] = forums;
  if (madras === undefined || karnataka === undefined) throw new Error('court-day fixture: forums');
  const halls = await tx
    .insert(courtHall)
    .values([
      { workspaceId, forumId: madras.id, hallNo: '3' },
      { workspaceId, forumId: madras.id, hallNo: '12A' },
      { workspaceId, forumId: karnataka.id, hallNo: '1' },
      { workspaceId, forumId: karnataka.id, hallNo: '7' },
    ])
    .returning({ id: courtHall.id });
  const hallIds = halls.map((h) => h.id);

  const matters = await tx
    .insert(matter)
    .values(
      Array.from({ length: 20 }, (_, i) => ({
        workspaceId,
        title: `${PETITIONERS[i % PETITIONERS.length] ?? 'P'} v. ${RESPONDENTS[i % RESPONDENTS.length] ?? 'R'}`,
        practiceArea: 'writ',
        ownerMemberId,
      })),
    )
    .returning({ id: matter.id });
  const proceedings = await tx
    .insert(proceeding)
    .values(
      matters.map((m, i) => ({
        workspaceId,
        matterId: m.id,
        forumId: i % 2 === 0 ? madras.id : karnataka.id,
        caseTypeCode: 'WP',
        caseTypeRaw: 'W.P.',
        number: String(1000 + i),
        year: 2026,
        sourceType: 'manual' as const,
      })),
    )
    .returning({ id: proceeding.id, forumId: proceeding.forumId });
  // Two listings per proceeding: a daily item in one of the forum's halls, and a supplementary item.
  const values = proceedings.flatMap((p, i) => {
    const halls = p.forumId === madras.id ? hallIds.slice(0, 2) : hallIds.slice(2);
    const hallId = halls[i % 2] ?? null;
    return [
      {
        workspaceId,
        proceedingId: p.id,
        listDate: date,
        listType: 'daily' as const,
        itemNo: String(1 + ((i * 7) % 24)),
        stageRaw: STAGES[i % STAGES.length] ?? 'FOR ORDERS',
        hallId,
        sourceType: 'manual' as const,
      },
      {
        workspaceId,
        proceedingId: p.id,
        listDate: date,
        listType: 'supplementary' as const,
        itemNo: String(30 + i),
        stageRaw: 'FOR ORDERS',
        hallId,
        sourceType: 'manual' as const,
      },
    ];
  });
  const listings = await tx.insert(listing).values(values).returning({ id: listing.id });
  return {
    forumIds: { madras: madras.id, karnataka: karnataka.id },
    hallIds,
    matterIds: matters.map((m) => m.id),
    proceedingIds: proceedings.map((p) => p.id),
    listingIds: listings.map((l) => l.id),
  };
}
