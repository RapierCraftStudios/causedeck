// Synthetic matter sets (#386, part 1 of #40): a fictional Chennai solo practice and a fictional
// Bengaluru chamber, sized for the matters-list perf check (the two sets at their defaults make 500
// matters and 1,500 proceedings). A pure generator: it returns rows for one workspace and writes
// nothing (index.ts inserts them). Stories, e2e and perf tests call it with their own workspace,
// forums and members.
//
// - Fictional only: every person name ends in "(fictional)", case numbers are `SYN-NNNN`, no CNR
//   or neutral citation is ever set, emails use `.test`.
// - Deterministic: ids are derived from the market, the workspace and a running number, so the
//   same call returns the same rows and a second insert writes nothing. Dates are offsets from
//   `today` (Asia/Kolkata).
// - Court-faithful: Madras HC nomenclature (W.P., O.S., Crl.O.P., W.M.P. children) for Chennai,
//   Karnataka HC (W.P., R.F.A., O.S., I.A. children) for Bengaluru.
import { createHash } from 'node:crypto';

import type { InferInsertModel } from 'drizzle-orm';

import type { listing, obligation } from '../../schema/docket.ts';
import type { matter } from '../../schema/matter-graph.ts';
import type { person, roleEdge } from '../../schema/people.ts';
import type { proceeding } from '../../schema/proceedings.ts';

export const SYNTHETIC_MARKETS = ['chennai-solo', 'bengaluru-chamber'] as const;
export type SyntheticMarket = (typeof SYNTHETIC_MARKETS)[number];

/** Matters per set by default: the two sets make the 500-matter perf workspace. */
export const SYNTHETIC_DEFAULT_MATTERS = 250;
/** Proceedings per matter by default (a main proceeding and two children): 1,500 in all. */
export const SYNTHETIC_DEFAULT_PROCEEDINGS_PER_MATTER = 3;

export const SYNTHETIC_FICTIONAL_SUFFIX = ' (fictional)';

export interface SyntheticMatterSetOptions {
  market: SyntheticMarket;
  workspaceId: string;
  /** The forums the proceedings are spread over (at least one). */
  forumIds: readonly string[];
  /** Owners the matters are spread over; every fifth matter has none. */
  ownerMemberIds?: readonly string[];
  matters?: number;
  proceedingsPerMatter?: number;
  /** The seed day (`yyyy-mm-dd`, Asia/Kolkata). */
  today: string;
}

export interface SyntheticMatterSet {
  workspaceId: string;
  matters: InferInsertModel<typeof matter>[];
  persons: InferInsertModel<typeof person>[];
  roleEdges: InferInsertModel<typeof roleEdge>[];
  proceedings: InferInsertModel<typeof proceeding>[];
  listings: InferInsertModel<typeof listing>[];
  obligations: InferInsertModel<typeof obligation>[];
}

interface MarketSpec {
  /** Case numbers run from here, so the two sets never share one. */
  numberBase: number;
  givenNames: readonly string[];
  familyNames: readonly string[];
  firms: readonly string[];
  mainTypes: readonly { code: string; raw: string; area: string }[];
  child: { code: string; raw: string };
  stages: readonly string[];
}

// prettier-ignore
const MARKETS: Record<SyntheticMarket, MarketSpec> = {
  'chennai-solo': {
    numberBase: 0,
    givenNames: ['Ilakkiya', 'Mugilan', 'Vennila', 'Nithilan', 'Poongodi', 'Aadhavan', 'Kayal', 'Sudar', 'Yazhini', 'Inban'],
    familyNames: ['Senthil', 'Maran', 'Velpari', 'Kathir', 'Arivu', 'Nedumaran', 'Thendral'],
    firms: ['Neithal Shipping Agencies', 'Kurinji Port Services', 'Marudham Agro Exports', 'Palai Cold Chain', 'Mullai Traders'],
    mainTypes: [
      { code: 'WP', raw: 'W.P.', area: 'writ' },
      { code: 'OS', raw: 'O.S.', area: 'civil_suit' },
      { code: 'CRLOP', raw: 'Crl.O.P.', area: 'bail' },
    ],
    child: { code: 'WMP', raw: 'W.M.P.' },
    stages: ['FOR ADMISSION', 'FOR ORDERS', 'FOR HEARING', 'BAIL APPLICATIONS'],
  },
  'bengaluru-chamber': {
    numberBase: 5000,
    givenNames: ['Chiranth', 'Sanvi', 'Tejas', 'Ishwari', 'Nuthan', 'Vismaya', 'Prerana', 'Manasa', 'Hamsa', 'Kanthi'],
    familyNames: ['Hosmane', 'Kanthiraj', 'Shettigar', 'Gowdru', 'Hegganna', 'Tunga', 'Basavaraju'],
    firms: ['Vismaya Developers', 'Hamsa Leasing Co.', 'Prerana Power Systems', 'Manasa Facility Management', 'Sharavathi Bus Operators'],
    mainTypes: [
      { code: 'WP', raw: 'W.P.', area: 'writ' },
      { code: 'RFA', raw: 'R.F.A.', area: 'civil_suit' },
      { code: 'OS', raw: 'O.S.', area: 'civil_suit' },
    ],
    child: { code: 'IA', raw: 'I.A.' },
    stages: ['PRELIMINARY HEARING', 'FOR ORDERS', 'PLAINTIFF EVIDENCE', 'FOR ARGUMENTS'],
  },
};

/** A fixed, v4-shaped id from the market, the workspace, the row kind and a running number. */
function syntheticId(
  market: SyntheticMarket,
  workspaceId: string,
  kind: string,
  n: number,
): string {
  const hex = createHash('sha256')
    .update(`synthetic:${market}:${workspaceId}:${kind}:${String(n)}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function pick<T>(list: readonly T[], i: number): T {
  const value = list[i % list.length];
  if (value === undefined) throw new RangeError('pick: empty list');
  return value;
}

const fictional = (name: string) => `${name}${SYNTHETIC_FICTIONAL_SUFFIX}`;

/** The rows of one synthetic matter set for `workspaceId`. */
export function syntheticMatterSet(options: SyntheticMatterSetOptions): SyntheticMatterSet {
  const {
    market,
    workspaceId,
    forumIds,
    ownerMemberIds = [],
    matters: count = SYNTHETIC_DEFAULT_MATTERS,
    proceedingsPerMatter = SYNTHETIC_DEFAULT_PROCEEDINGS_PER_MATTER,
    today,
  } = options;
  if (forumIds.length === 0) throw new RangeError('syntheticMatterSet: no forums');
  if (!Number.isInteger(count) || count < 0) throw new RangeError('syntheticMatterSet: matters');
  if (!Number.isInteger(proceedingsPerMatter) || proceedingsPerMatter < 1) {
    throw new RangeError('syntheticMatterSet: proceedingsPerMatter');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today))
    throw new TypeError(`syntheticMatterSet: bad day ${today}`);
  const spec = MARKETS[market];
  const id = (kind: string, n: number) => syntheticId(market, workspaceId, kind, n);
  const at = new Date(`${today}T09:00:00+05:30`);
  const provenance = {
    sourceType: 'system' as const,
    sourceRef: `seed:synthetic:${market}`,
    confirmationState: 'confirmed' as const,
    capturedAt: at,
  };
  const set: SyntheticMatterSet = {
    workspaceId,
    matters: [],
    persons: [],
    roleEdges: [],
    proceedings: [],
    listings: [],
    obligations: [],
  };

  for (let i = 1; i <= count; i++) {
    const matterId = id('matter', i);
    const client = fictional(`${pick(spec.givenNames, i)} ${pick(spec.familyNames, i * 3)}`);
    const opponent = fictional(pick(spec.firms, i));
    const counsel = fictional(`${pick(spec.givenNames, i + 5)} ${pick(spec.familyNames, i + 1)}`);
    const type = pick(spec.mainTypes, i);
    const stamped = new Date(at.getTime() - i * 3_600_000);
    set.matters.push({
      id: matterId,
      workspaceId,
      title: `${client} v. ${opponent}`,
      practiceArea: type.area,
      status: i % 25 === 0 ? 'disposed' : 'active',
      sensitive: i % 17 === 0,
      ownerMemberId: ownerMemberIds.length === 0 || i % 5 === 0 ? null : pick(ownerMemberIds, i),
      openedAt: stamped,
      createdAt: stamped,
      updatedAt: stamped,
    });

    const clientId = id('person', i * 3);
    const opponentId = id('person', i * 3 + 1);
    const counselId = id('person', i * 3 + 2);
    set.persons.push(
      {
        id: clientId,
        workspaceId,
        name: client,
        kind: 'client',
        contact: { email: `client-${market}-${String(i)}@synthetic.test` },
        ...provenance,
      },
      { id: opponentId, workspaceId, name: opponent, kind: 'party', ...provenance },
      {
        id: counselId,
        workspaceId,
        name: counsel,
        aliases: [counsel.replace(/^(\S)\S*/, '$1.')],
        kind: 'advocate',
        ...provenance,
      },
    );

    const mainId = id('proceeding', i * 10);
    const forumId = pick(forumIds, i);
    const year = 2020 + (i % 7);
    set.proceedings.push({
      id: mainId,
      workspaceId,
      matterId,
      forumId,
      kind: 'main',
      caseTypeCode: type.code,
      caseTypeRaw: type.raw,
      number: `SYN-${String(spec.numberBase + i).padStart(4, '0')}`,
      year,
      state: i % 25 === 0 ? 'disposed' : 'numbered',
      titlePetitioner: client,
      titleRespondent: opponent,
      createdAt: stamped,
      updatedAt: stamped,
      ...provenance,
    });
    for (let c = 1; c < proceedingsPerMatter; c++) {
      set.proceedings.push({
        id: id('proceeding', i * 10 + c),
        workspaceId,
        matterId,
        forumId,
        kind: 'misc',
        caseTypeCode: spec.child.code,
        caseTypeRaw: spec.child.raw,
        // Children are still at the SR stage: no number yet.
        srNo: `SR-SYN-${String(spec.numberBase + i)}-${String(c)}`,
        state: 'sr_fr',
        parentProceedingId: mainId,
        titlePetitioner: client,
        titleRespondent: opponent,
        createdAt: new Date(stamped.getTime() + c * 60_000),
        updatedAt: stamped,
        ...provenance,
      });
    }

    set.roleEdges.push(
      {
        id: id('role_edge', i * 3),
        workspaceId,
        kind: 'instructed_by',
        fromPersonId: clientId,
        matterId,
        ...provenance,
      },
      {
        id: id('role_edge', i * 3 + 1),
        workspaceId,
        kind: 'opposes',
        fromPersonId: opponentId,
        matterId,
        ...provenance,
      },
      {
        id: id('role_edge', i * 3 + 2),
        workspaceId,
        kind: 'appears_for',
        fromPersonId: counselId,
        proceedingId: mainId,
        ...provenance,
      },
    );

    // A quarter without a next date, a quarter with only a past one, half upcoming; every fourth
    // upcoming one also carries a proposed date that conflicts with it.
    const stage = pick(spec.stages, i);
    const shape = i % 4;
    if (shape !== 0) {
      set.listings.push({
        id: id('listing', i * 2),
        workspaceId,
        proceedingId: mainId,
        listDate: shape === 2 ? addDays(today, -10 - (i % 20)) : addDays(today, i % 45),
        listType: 'daily',
        stageRaw: stage,
        canonical: true,
        ...provenance,
      });
    }
    if (shape === 3) {
      set.listings.push({
        id: id('listing', i * 2 + 1),
        workspaceId,
        proceedingId: mainId,
        listDate: addDays(today, (i % 45) + 7),
        listType: 'advance',
        stageRaw: stage,
        canonical: false,
        ...provenance,
        sourceType: 'adapter',
        sourceRef: `synthetic:advance-list:${String(i)}`,
        confirmationState: 'proposed',
      });
    }
    if (i % 3 === 0) {
      set.obligations.push({
        id: id('obligation', i),
        workspaceId,
        matterId,
        proceedingId: mainId,
        source: 'order_direction',
        description: 'File counter affidavit',
        dueDate: addDays(today, (i % 21) - 7),
        ...provenance,
      });
    }
  }
  return set;
}
