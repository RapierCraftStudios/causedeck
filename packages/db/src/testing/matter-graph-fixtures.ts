// Matter-graph fixture builders (#349, part 6 of #32): typed builders for the graph tables and a
// Chennai-solo-style graph for service and UI tests. Every builder inserts one row through `tx` and
// returns it; `tx` must already be scoped to `workspaceId` (`inWorkspace()` / `withWorkspace()`),
// because the tables are under FORCE RLS. Court reference rows are the workspace's own (A0) forum,
// hall and bench: catalogue rows (null workspace_id) are writable only by the owner role.
//
// Fixtures use fictional people only (no real party, advocate or judge names): every name a builder
// writes comes from FICTIONAL_NAMES, which matter-graph-fixtures.test.ts enforces.
import { createHash, randomUUID } from 'node:crypto';

import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

import type { Transaction } from '../client.ts';
import { bench, courtHall, forum } from '../schema/court.ts';
import { hearing, listing, obligation, order, task } from '../schema/docket.ts';
import { anchor, document } from '../schema/documents.ts';
import { matter } from '../schema/matter-graph.ts';
import { person, roleEdge } from '../schema/people.ts';
import { proceeding, proceedingLink } from '../schema/proceedings.ts';

/** Fictional names, the only personal names the fixtures write. Each ends in "(fictional)". */
export const FICTIONAL_NAMES = {
  petitioner: 'P. Ilango (fictional)',
  respondent: 'Mullai Traders (fictional)',
  advocate: 'R. Nila (fictional)',
  junior: 'S. Kathir (fictional)',
  judges: ['Hon. Justice A. Venpa (fictional)', 'Hon. Justice K. Marudham (fictional)'],
} as const;

/** Every fictional name as a flat list. */
export const FICTIONAL_NAME_LIST: readonly string[] = [
  FICTIONAL_NAMES.petitioner,
  FICTIONAL_NAMES.respondent,
  FICTIONAL_NAMES.advocate,
  FICTIONAL_NAMES.junior,
  ...FICTIONAL_NAMES.judges,
];

type GraphTable =
  | typeof forum
  | typeof courtHall
  | typeof bench
  | typeof matter
  | typeof document
  | typeof anchor
  | typeof proceeding
  | typeof proceedingLink
  | typeof listing
  | typeof hearing
  | typeof order
  | typeof obligation
  | typeof task
  | typeof person
  | typeof roleEdge;

/** Column values a builder caller may set; the builder fills in valid defaults for the rest. */
type Overrides<T extends GraphTable> = Partial<InferInsertModel<T>>;

function one<T>(rows: T[], table: string): T {
  const [row] = rows;
  if (row === undefined) throw new Error(`${table} fixture insert returned no row`);
  return row;
}

/** A short unique suffix that fits slug-like patterns (no UUID hyphens). */
function suffix(): string {
  return randomUUID().replaceAll('-', '').slice(0, 12);
}

export async function buildForum(
  tx: Transaction,
  workspaceId: string,
  overrides: Overrides<typeof forum> = {},
): Promise<InferSelectModel<typeof forum>> {
  const rows = await tx
    .insert(forum)
    .values({
      workspaceId,
      code: `test.in.tn.madras-hc.${suffix()}`,
      court: 'High Court of Madras',
      establishment: 'Principal Seat',
      seat: 'Chennai',
      side: 'original',
      jurisdictionKind: 'high_court',
      ...overrides,
    })
    .returning();
  return one(rows, 'forum');
}

export async function buildCourtHall(
  tx: Transaction,
  workspaceId: string,
  overrides: Overrides<typeof courtHall> & { forumId: string },
): Promise<InferSelectModel<typeof courtHall>> {
  const rows = await tx
    .insert(courtHall)
    .values({ workspaceId, hallNo: '12A', label: 'Court Hall 12A', ...overrides })
    .returning();
  return one(rows, 'court_hall');
}

export async function buildBench(
  tx: Transaction,
  workspaceId: string,
  overrides: Overrides<typeof bench> & { forumId: string },
): Promise<InferSelectModel<typeof bench>> {
  const rows = await tx
    .insert(bench)
    .values({
      workspaceId,
      judges: [...FICTIONAL_NAMES.judges],
      benchKind: 'division',
      ...overrides,
    })
    .returning();
  return one(rows, 'bench');
}

export async function buildMatter(
  tx: Transaction,
  workspaceId: string,
  overrides: Overrides<typeof matter> = {},
): Promise<InferSelectModel<typeof matter>> {
  const rows = await tx
    .insert(matter)
    .values({
      workspaceId,
      title: `${FICTIONAL_NAMES.petitioner} v. ${FICTIONAL_NAMES.respondent}`,
      practiceArea: 'writ',
      ...overrides,
    })
    .returning();
  return one(rows, 'matter');
}

export async function buildDocument(
  tx: Transaction,
  workspaceId: string,
  overrides: Overrides<typeof document> = {},
): Promise<InferSelectModel<typeof document>> {
  const key = suffix();
  const rows = await tx
    .insert(document)
    .values({
      workspaceId,
      kind: 'order',
      storageKey: `fixtures/${key}.pdf`,
      sha256: createHash('sha256').update(key).digest('hex'),
      ...overrides,
    })
    .returning();
  return one(rows, 'document');
}

export async function buildAnchor(
  tx: Transaction,
  workspaceId: string,
  overrides: Overrides<typeof anchor> & { documentId: string },
): Promise<InferSelectModel<typeof anchor>> {
  const rows = await tx
    .insert(anchor)
    .values({
      workspaceId,
      pageNo: 1,
      quote: 'List after two weeks.',
      kind: 'document',
      ...overrides,
    })
    .returning();
  return one(rows, 'anchor');
}

export async function buildProceeding(
  tx: Transaction,
  workspaceId: string,
  overrides: Overrides<typeof proceeding> & { matterId: string; forumId: string },
): Promise<InferSelectModel<typeof proceeding>> {
  const rows = await tx
    .insert(proceeding)
    .values({
      workspaceId,
      caseTypeCode: 'WP',
      caseTypeRaw: 'W.P.',
      sourceType: 'manual',
      ...overrides,
    })
    .returning();
  return one(rows, 'proceeding');
}

export async function buildProceedingLink(
  tx: Transaction,
  workspaceId: string,
  overrides: Overrides<typeof proceedingLink> & {
    fromProceedingId: string;
    toProceedingId: string;
  },
): Promise<InferSelectModel<typeof proceedingLink>> {
  const rows = await tx
    .insert(proceedingLink)
    .values({ workspaceId, kind: 'parent_of', sourceType: 'manual', ...overrides })
    .returning();
  return one(rows, 'proceeding_link');
}

export async function buildListing(
  tx: Transaction,
  workspaceId: string,
  overrides: Overrides<typeof listing> & { proceedingId: string },
): Promise<InferSelectModel<typeof listing>> {
  const rows = await tx
    .insert(listing)
    .values({
      workspaceId,
      listDate: '2026-11-02',
      listType: 'daily',
      stageRaw: 'FOR ADMISSION',
      sourceType: 'manual',
      ...overrides,
    })
    .returning();
  return one(rows, 'listing');
}

export async function buildHearing(
  tx: Transaction,
  workspaceId: string,
  overrides: Overrides<typeof hearing> & { listingId: string },
): Promise<InferSelectModel<typeof hearing>> {
  const rows = await tx
    .insert(hearing)
    .values({ workspaceId, heldOn: '2026-11-02', sourceType: 'manual', ...overrides })
    .returning();
  return one(rows, 'hearing');
}

export async function buildOrder(
  tx: Transaction,
  workspaceId: string,
  overrides: Overrides<typeof order> & { proceedingId: string; documentId: string },
): Promise<InferSelectModel<typeof order>> {
  const rows = await tx
    .insert(order)
    .values({
      workspaceId,
      orderDate: '2026-11-02',
      orderType: 'interim',
      sourceType: 'manual',
      ...overrides,
    })
    .returning();
  return one(rows, 'order');
}

export async function buildObligation(
  tx: Transaction,
  workspaceId: string,
  overrides: Overrides<typeof obligation> & { matterId: string },
): Promise<InferSelectModel<typeof obligation>> {
  const rows = await tx
    .insert(obligation)
    .values({
      workspaceId,
      source: 'order_direction',
      description: 'File counter affidavit within two weeks',
      sourceType: 'manual',
      ...overrides,
    })
    .returning();
  return one(rows, 'obligation');
}

export async function buildTask(
  tx: Transaction,
  workspaceId: string,
  overrides: Overrides<typeof task> = {},
): Promise<InferSelectModel<typeof task>> {
  const rows = await tx
    .insert(task)
    .values({ workspaceId, title: 'Draft counter affidavit', sourceType: 'manual', ...overrides })
    .returning();
  return one(rows, 'task');
}

export async function buildPerson(
  tx: Transaction,
  workspaceId: string,
  overrides: Overrides<typeof person> = {},
): Promise<InferSelectModel<typeof person>> {
  const rows = await tx
    .insert(person)
    .values({
      workspaceId,
      name: FICTIONAL_NAMES.petitioner,
      kind: 'party',
      sourceType: 'manual',
      ...overrides,
    })
    .returning();
  return one(rows, 'person');
}

export async function buildRoleEdge(
  tx: Transaction,
  workspaceId: string,
  overrides: Overrides<typeof roleEdge> & { fromPersonId: string },
): Promise<InferSelectModel<typeof roleEdge>> {
  const rows = await tx
    .insert(roleEdge)
    .values({ workspaceId, kind: 'represents', sourceType: 'manual', ...overrides })
    .returning();
  return one(rows, 'role_edge');
}

/** The ids of a Chennai-solo graph. */
export interface ChennaiSoloGraph {
  forumId: string;
  hallId: string;
  benchId: string;
  matterId: string;
  /** The numbered main writ petition, W.P. No. 10234 of 2026. */
  writPetitionId: string;
  /** The two W.M.P.s (miscellaneous petitions) under the W.P. */
  miscPetitionIds: [string, string];
  /** A writ petition still at the SR (stamp register) stage: no number yet. */
  srStageId: string;
  /** The writ appeal against the W.P. */
  writAppealId: string;
  listingId: string;
  personIds: { petitioner: string; respondent: string; advocate: string };
}

/**
 * A solo Chennai advocate's writ matter: a W.P. with two W.M.P. children (parent and `parent_of`
 * links), an SR-stage W.P., and a W.A. linked to the W.P. by `appeal_from`, before the workspace's
 * own Madras High Court forum, with a canonical listing and fictional parties.
 */
export async function buildChennaiSoloGraph(
  tx: Transaction,
  workspaceId: string,
): Promise<ChennaiSoloGraph> {
  const f = await buildForum(tx, workspaceId);
  const hall = await buildCourtHall(tx, workspaceId, { forumId: f.id });
  const b = await buildBench(tx, workspaceId, { forumId: f.id });
  const m = await buildMatter(tx, workspaceId);
  const titles = {
    titlePetitioner: FICTIONAL_NAMES.petitioner,
    titleRespondent: FICTIONAL_NAMES.respondent,
  };
  const base = { matterId: m.id, forumId: f.id, ...titles };

  const wp = await buildProceeding(tx, workspaceId, {
    ...base,
    kind: 'main',
    number: '10234',
    year: 2026,
    state: 'numbered',
  });
  const misc: string[] = [];
  for (const number of ['11570', '11571']) {
    const wmp = await buildProceeding(tx, workspaceId, {
      ...base,
      kind: 'misc',
      caseTypeCode: 'WMP',
      caseTypeRaw: 'W.M.P.',
      number,
      year: 2026,
      state: 'numbered',
      parentProceedingId: wp.id,
    });
    await buildProceedingLink(tx, workspaceId, {
      fromProceedingId: wp.id,
      toProceedingId: wmp.id,
      kind: 'parent_of',
    });
    misc.push(wmp.id);
  }
  const sr = await buildProceeding(tx, workspaceId, {
    ...base,
    kind: 'main',
    state: 'sr_fr',
    srNo: '45678',
    filingDate: '2026-10-05',
  });
  const wa = await buildProceeding(tx, workspaceId, {
    ...base,
    kind: 'appeal',
    caseTypeCode: 'WA',
    caseTypeRaw: 'W.A.',
    number: '2101',
    year: 2026,
    state: 'numbered',
  });
  await buildProceedingLink(tx, workspaceId, {
    fromProceedingId: wa.id,
    toProceedingId: wp.id,
    kind: 'appeal_from',
  });
  const l = await buildListing(tx, workspaceId, {
    proceedingId: wp.id,
    hallId: hall.id,
    benchId: b.id,
    canonical: true,
    listNo: 1,
    itemNo: '14',
  });

  const petitioner = await buildPerson(tx, workspaceId, {
    name: FICTIONAL_NAMES.petitioner,
    kind: 'client',
  });
  const respondent = await buildPerson(tx, workspaceId, {
    name: FICTIONAL_NAMES.respondent,
    kind: 'party',
  });
  const advocate = await buildPerson(tx, workspaceId, {
    name: FICTIONAL_NAMES.advocate,
    kind: 'advocate',
  });
  await buildRoleEdge(tx, workspaceId, {
    kind: 'represents',
    fromPersonId: advocate.id,
    toPersonId: petitioner.id,
  });
  await buildRoleEdge(tx, workspaceId, {
    kind: 'opposes',
    fromPersonId: petitioner.id,
    toPersonId: respondent.id,
  });
  await buildRoleEdge(tx, workspaceId, {
    kind: 'appears_for',
    fromPersonId: advocate.id,
    proceedingId: wp.id,
  });

  const [firstMisc, secondMisc] = misc;
  if (firstMisc === undefined || secondMisc === undefined) throw new Error('W.M.P.s missing');
  return {
    forumId: f.id,
    hallId: hall.id,
    benchId: b.id,
    matterId: m.id,
    writPetitionId: wp.id,
    miscPetitionIds: [firstMisc, secondMisc],
    srStageId: sr.id,
    writAppealId: wa.id,
    listingId: l.id,
    personIds: { petitioner: petitioner.id, respondent: respondent.id, advocate: advocate.id },
  };
}
