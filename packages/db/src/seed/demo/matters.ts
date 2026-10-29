// Matters of the demo seed (#182, #93): 40 fictional matters per demo workspace, hand-written
// anchors (13 before the Madras High Court; 12 before the Bengaluru courts) topped up with matters
// generated from a seeded PRNG, covering writ, civil suit, bail, arbitration, family and
// magistrate cases. Each matter gets a client and an opposing party, its proceedings, hearings over
// the last 30 days, a canonical next listing (some today and tomorrow), one or two orders with a
// generated PDF, two or more obligations (defects, certified copies, carry-forward items) and tasks.
// Every date is an offset from the seed day.
//
// Case numbers are obviously fake: `number` is `DEMO-NNNN`, shown as `<TYPE>-DEMO/<year>/<NNNN>`
// (e.g. `WP-DEMO/2026/0001`). No CNR or neutral citation is ever set.
import type { InferInsertModel } from 'drizzle-orm';

import type {
  hearing,
  listing,
  obligation,
  order,
  OperativeDirection,
  task,
} from '../../schema/docket.ts';
import type { anchor, document } from '../../schema/documents.ts';
import type { matter } from '../../schema/matter-graph.ts';
import type { person, roleEdge } from '../../schema/people.ts';
import type { proceeding, proceedingLink } from '../../schema/proceedings.ts';

import { benchId, forumId, hallId, type DemoForumKey } from './courts.ts';
import { demoOrderPdf } from './pdf.ts';
import { demoMember, fictional, OPPOSING_ADVOCATES, type DemoMemberKey } from './people.ts';
import { addDays, createPrng, demoId, demoProvenance, ID_KIND } from './shared.ts';
import type { DemoWorkspaceSpec } from './workspaces.ts';

export type DemoPracticeArea =
  'writ' | 'civil_suit' | 'bail' | 'arbitration' | 'family' | 'magistrate';

/** Matters per demo workspace. */
export const DEMO_MATTERS_PER_WORKSPACE = 40;

interface MatterSpec {
  forum: DemoForumKey;
  area: DemoPracticeArea;
  /** Normalised case type (upper-case, no dots) and as printed. */
  type: string;
  typeRaw: string;
  /** Our client, and whether they are the petitioner/plaintiff (true) or the respondent. */
  client: string;
  clientIsPetitioner: boolean;
  opponent: string;
  stage: string;
  disposed?: boolean;
  /** Still at the SR (stamp register) stage: no number yet. */
  srStage?: boolean;
  owner?: DemoMemberKey;
}

/** The hand-written matters. The first of the Chennai workspace is the writ graph: a W.P. with two W.M.P.s and a W.A. against it. */
// prettier-ignore
const BASE_MATTERS: Record<DemoWorkspaceSpec['key'], readonly MatterSpec[]> = {
  'chennai-solo': [
    { forum: 'mhc', area: 'writ', type: 'WP', typeRaw: 'W.P.', client: 'Ilakkiya Sudar', clientIsPetitioner: true, opponent: 'Directorate of Demo Licensing', stage: 'FOR ADMISSION' },
    { forum: 'mhc', area: 'writ', type: 'WP', typeRaw: 'W.P.', client: 'Thendral Textiles Pvt. Ltd.', clientIsPetitioner: true, opponent: 'Demo Pollution Control Board', stage: 'FOR ORDERS', owner: 'junior' },
    { forum: 'mhc', area: 'writ', type: 'WP', typeRaw: 'W.P.', client: 'Vennila Kayal', clientIsPetitioner: true, opponent: 'Demo Town Planning Authority', stage: 'SR CHECKING', srStage: true },
    { forum: 'mhc', area: 'bail', type: 'CRLOP', typeRaw: 'Crl.O.P.', client: 'Mugilan Aadhavan', clientIsPetitioner: true, opponent: 'Inspector of Police, Demo Nagar Station', stage: 'BAIL APPLICATIONS' },
    { forum: 'mhc', area: 'bail', type: 'CRLOP', typeRaw: 'Crl.O.P.', client: 'Sudar Nithilan', clientIsPetitioner: true, opponent: 'Inspector of Police, Demo Pettai Station', stage: 'BAIL APPLICATIONS', owner: 'junior' },
    { forum: 'mhc', area: 'civil_suit', type: 'CS', typeRaw: 'C.S.', client: 'Poongodi Estates LLP', clientIsPetitioner: true, opponent: 'Kalvettu Builders Pvt. Ltd.', stage: 'FOR TRIAL' },
    { forum: 'mhc', area: 'civil_suit', type: 'CS', typeRaw: 'C.S.', client: 'Yazhini Maran', clientIsPetitioner: false, opponent: 'Oviya Housing Finance Ltd.', stage: 'FOR FRAMING ISSUES' },
    { forum: 'mhc', area: 'arbitration', type: 'ARBOP', typeRaw: 'Arb.O.P.', client: 'Neithal Shipping Agencies', clientIsPetitioner: true, opponent: 'Kurinji Port Services Ltd.', stage: 'FOR HEARING' },
    { forum: 'mhc', area: 'arbitration', type: 'ARBOP', typeRaw: 'Arb.O.P.', client: 'Marudham Agro Exports', clientIsPetitioner: false, opponent: 'Palai Cold Chain Pvt. Ltd.', stage: 'FOR ADMISSION' },
    { forum: 'mhc', area: 'family', type: 'CMA', typeRaw: 'C.M.A.', client: 'Kayal Inbanathan', clientIsPetitioner: true, opponent: 'Inbanathan Velpari', stage: 'FOR ADMISSION' },
    { forum: 'mhc', area: 'family', type: 'CMA', typeRaw: 'C.M.A.', client: 'Arivu Senthil', clientIsPetitioner: false, opponent: 'Malar Arivu', stage: 'FOR HEARING', owner: 'junior' },
    { forum: 'mhc', area: 'writ', type: 'WP', typeRaw: 'W.P.', client: 'Elakkiya Traders', clientIsPetitioner: true, opponent: 'Demo Commercial Taxes Office', stage: 'DISPOSED', disposed: true },
    { forum: 'mhc', area: 'bail', type: 'CRLOP', typeRaw: 'Crl.O.P.', client: 'Nedumaran Kathir', clientIsPetitioner: true, opponent: 'Inspector of Police, Demo Kuppam Station', stage: 'ANTICIPATORY BAIL' },
  ],
  'bengaluru-chamber': [
    { forum: 'ccc', area: 'civil_suit', type: 'OS', typeRaw: 'O.S.', client: 'Chiranth Hosmane', clientIsPetitioner: true, opponent: 'Vismaya Developers Pvt. Ltd.', stage: 'PLAINTIFF EVIDENCE' },
    { forum: 'ccc', area: 'civil_suit', type: 'OS', typeRaw: 'O.S.', client: 'Sanvi Kanthiraj', clientIsPetitioner: false, opponent: 'Nuthan Shettigar', stage: 'FOR WRITTEN STATEMENT', owner: 'junior' },
    { forum: 'ccc', area: 'civil_suit', type: 'OS', typeRaw: 'O.S.', client: 'Tejas Malnad Stores', clientIsPetitioner: true, opponent: 'Hamsa Leasing Co.', stage: 'DISPOSED', disposed: true },
    { forum: 'ccc', area: 'arbitration', type: 'COMAS', typeRaw: 'Com.A.S.', client: 'Ishwari Infra Projects', clientIsPetitioner: true, opponent: 'Prerana Power Systems Ltd.', stage: 'FOR ARGUMENTS' },
    { forum: 'ccc', area: 'arbitration', type: 'COMAS', typeRaw: 'Com.A.S.', client: 'Kanthi Software Services', clientIsPetitioner: false, opponent: 'Manasa Facility Management', stage: 'FOR OBJECTIONS' },
    { forum: 'khc', area: 'writ', type: 'WP', typeRaw: 'W.P.', client: 'Hosmane Gram Vikas Samithi', clientIsPetitioner: true, opponent: 'Demo Urban Development Department', stage: 'PRELIMINARY HEARING' },
    { forum: 'khc', area: 'writ', type: 'WP', typeRaw: 'W.P.', client: 'Sharavathi Bus Operators', clientIsPetitioner: true, opponent: 'Demo Transport Authority', stage: 'FOR ORDERS', owner: 'junior' },
    { forum: 'khc', area: 'bail', type: 'CRLP', typeRaw: 'Crl.P.', client: 'Nuthan Gowdru', clientIsPetitioner: true, opponent: 'Demo Halli Police Station', stage: 'BAIL' },
    { forum: 'khc', area: 'bail', type: 'CRLP', typeRaw: 'Crl.P.', client: 'Vismaya Hegganna', clientIsPetitioner: true, opponent: 'Demo Pete Police Station', stage: 'BAIL' },
    { forum: 'khc', area: 'bail', type: 'CRLP', typeRaw: 'Crl.P.', client: 'Prerana Tunga', clientIsPetitioner: true, opponent: 'Demo Kere Police Station', stage: 'ANTICIPATORY BAIL' },
    { forum: 'khc', area: 'family', type: 'MFA', typeRaw: 'M.F.A.', client: 'Manasa Chiranth', clientIsPetitioner: true, opponent: 'Chiranth Basavaraju', stage: 'FOR ADMISSION' },
    { forum: 'khc', area: 'family', type: 'MFA', typeRaw: 'M.F.A.', client: 'Hamsa Kaveri', clientIsPetitioner: false, opponent: 'Kaveri Ranganatha', stage: 'FOR HEARING' },
    { forum: 'mayo', area: 'magistrate', type: 'CC', typeRaw: 'C.C.', client: 'Netravati Sweets and Bakes', clientIsPetitioner: true, opponent: 'Hebbalu Wholesale Traders', stage: 'FOR EVIDENCE' },
  ],
};

const FIRST_NAMES: Record<DemoWorkspaceSpec['key'], readonly string[]> = {
  'chennai-solo': [
    'Ilaiyaraj',
    'Thamarai',
    'Mukil',
    'Pavalam',
    'Kuyil',
    'Sendhil',
    'Aruvi',
    'Nedun',
    'Vaigai',
    'Tholkapi',
    'Mullai',
    'Azhagu',
    'Kanmani',
    'Seval',
    'Pon',
  ],
  'bengaluru-chamber': [
    'Chinmaya',
    'Nethra',
    'Hemanth',
    'Vasanthi',
    'Yashas',
    'Kaveramma',
    'Sahana',
    'Bhargav',
    'Lakshmeesha',
    'Rangaiah',
    'Shivani',
    'Deepthi',
    'Mahesh',
    'Tejaswi',
    'Anagha',
  ],
};
const SURNAMES = [
  'Vendhan',
  'Sengol',
  'Arasu',
  'Kottai',
  'Ezhil',
  'Malaiyur',
  'Hosur',
  'Gowdru',
  'Hegde',
  'Shettigar',
  'Nayaka',
  'Bhatru',
  'Marulu',
  'Kolar',
  'Thirunelveli',
  'Pattar',
];
const COMPANY_WORDS = [
  'Marina',
  'Cauvery',
  'Lalbagh',
  'Pallava',
  'Hoysala',
  'Vaigai',
  'Nandi',
  'Kolar',
  'Poompuhar',
  'Chola',
  'Sahyadri',
  'Mylapore',
];
const COMPANY_KINDS = [
  'Textiles Pvt. Ltd.',
  'Logistics LLP',
  'Foods Pvt. Ltd.',
  'Infra Projects Ltd.',
  'Agro Exports',
  'Software Services Pvt. Ltd.',
  'Estates LLP',
  'Traders',
];
const DEPARTMENTS = [
  'Revenue Department',
  'Housing Board',
  'Water Supply Board',
  'Labour Commissioner',
  'Education Department',
  'Transport Authority',
  'Registration Department',
  'Municipal Corporation',
];
const STATIONS = [
  'Anna Nagar',
  'Teynampet',
  'Basavanagudi',
  'Jayanagar',
  'Adyar',
  'Whitefield',
  'Mylapore',
  'Indiranagar',
  'Pettai',
  'Halli',
];

interface Template {
  area: DemoPracticeArea;
  type: string;
  typeRaw: string;
  stages: readonly string[];
}

const TEMPLATES: Record<DemoForumKey, readonly Template[]> = {
  mhc: [
    {
      area: 'writ',
      type: 'WP',
      typeRaw: 'W.P.',
      stages: ['FOR ADMISSION', 'FOR ORDERS', 'FOR HEARING', 'FOR FINAL HEARING'],
    },
    {
      area: 'bail',
      type: 'CRLOP',
      typeRaw: 'Crl.O.P.',
      stages: ['BAIL APPLICATIONS', 'ANTICIPATORY BAIL', 'FOR ORDERS'],
    },
    {
      area: 'civil_suit',
      type: 'CS',
      typeRaw: 'C.S.',
      stages: ['FOR TRIAL', 'FOR FRAMING ISSUES', 'FOR EVIDENCE'],
    },
    {
      area: 'arbitration',
      type: 'ARBOP',
      typeRaw: 'Arb.O.P.',
      stages: ['FOR HEARING', 'FOR ADMISSION'],
    },
    { area: 'family', type: 'CMA', typeRaw: 'C.M.A.', stages: ['FOR ADMISSION', 'FOR HEARING'] },
  ],
  khc: [
    {
      area: 'writ',
      type: 'WP',
      typeRaw: 'W.P.',
      stages: ['PRELIMINARY HEARING', 'FOR ORDERS', 'FOR FINAL HEARING'],
    },
    {
      area: 'bail',
      type: 'CRLP',
      typeRaw: 'Crl.P.',
      stages: ['BAIL', 'ANTICIPATORY BAIL', 'FOR ORDERS'],
    },
    { area: 'family', type: 'MFA', typeRaw: 'M.F.A.', stages: ['FOR ADMISSION', 'FOR HEARING'] },
    {
      area: 'civil_suit',
      type: 'RFA',
      typeRaw: 'R.F.A.',
      stages: ['FOR ADMISSION', 'FOR HEARING', 'OBJECTIONS'],
    },
  ],
  ccc: [
    {
      area: 'civil_suit',
      type: 'OS',
      typeRaw: 'O.S.',
      stages: ['PLAINTIFF EVIDENCE', 'FOR WRITTEN STATEMENT', 'FOR ARGUMENTS', 'FOR ISSUES'],
    },
    {
      area: 'arbitration',
      type: 'COMAS',
      typeRaw: 'Com.A.S.',
      stages: ['FOR ARGUMENTS', 'FOR OBJECTIONS'],
    },
  ],
  mayo: [
    {
      area: 'magistrate',
      type: 'CC',
      typeRaw: 'C.C.',
      stages: ['FOR EVIDENCE', 'FOR APPEARANCE', 'FOR ARGUMENTS'],
    },
    {
      area: 'magistrate',
      type: 'PCR',
      typeRaw: 'P.C.R.',
      stages: ['FOR ORDERS', 'FOR SWORN STATEMENT'],
    },
  ],
};

/**
 * The matter specs of `ws`: the hand-written anchors, then matters generated from the workspace's
 * seeded PRNG until there are `DEMO_MATTERS_PER_WORKSPACE`. Deterministic: the same on every run.
 */
export function matterSpecs(ws: DemoWorkspaceSpec): MatterSpec[] {
  const specs = [...BASE_MATTERS[ws.key]];
  const rand = createPrng(ws.prngSeed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
  const person = () => `${pick(FIRST_NAMES[ws.key])} ${pick(SURNAMES)}`;
  const company = () => `${pick(COMPANY_WORDS)} ${pick(COMPANY_KINDS)}`;
  let k = 0;
  while (specs.length < DEMO_MATTERS_PER_WORKSPACE) {
    const forum = ws.forums[k % ws.forums.length] as DemoForumKey;
    const templates = TEMPLATES[forum];
    const t = templates[Math.floor(k / ws.forums.length) % templates.length] as Template;
    k++;
    const corporate =
      t.area === 'civil_suit' || t.area === 'arbitration' || t.area === 'magistrate';
    const opponent =
      t.area === 'writ'
        ? `Demo ${pick(DEPARTMENTS)}`
        : t.area === 'bail'
          ? `Inspector of Police, Demo ${pick(STATIONS)} Station`
          : corporate
            ? company()
            : person();
    specs.push({
      forum,
      area: t.area,
      type: t.type,
      typeRaw: t.typeRaw,
      client: corporate && rand() < 0.5 ? company() : person(),
      clientIsPetitioner: rand() < 0.7,
      opponent,
      stage: pick(t.stages),
      ...(rand() < 0.25 && ws.members.includes('junior') ? { owner: 'junior' as const } : {}),
      ...(k % 17 === 0 ? { disposed: true, stage: 'DISPOSED' } : {}),
    });
  }
  return specs;
}

/**
 * Next-date offsets (days from the seed day) of the active matters, in order: four today and four
 * tomorrow so the Today and Tomorrow boards populate, the rest spread over the next six weeks.
 */
const NEXT_DATE_OFFSETS = [
  0, 1, 0, 1, 2, 0, 1, 3, 6, 8, 10, 13, 15, 20, 27, 34, 41, 0, 1, 4, 7, 9, 11,
];

const HEARING_OUTCOMES = [
  'Adjourned at the request of the respondent.',
  'Heard in part; to continue.',
  'Notice ordered; counter in two weeks.',
  'Adjourned for want of time.',
];

/** `WP-DEMO/2026/0001`: the displayed form of a demo case number. */
export function demoCaseNumber(type: string, year: number, seq: number): string {
  return `${type}-DEMO/${String(year)}/${String(seq).padStart(4, '0')}`;
}

export interface DemoMatterRows {
  matters: InferInsertModel<typeof matter>[];
  persons: InferInsertModel<typeof person>[];
  roleEdges: InferInsertModel<typeof roleEdge>[];
  /** Parents before children (`parent_proceeding_id`). */
  proceedings: InferInsertModel<typeof proceeding>[];
  proceedingLinks: InferInsertModel<typeof proceedingLink>[];
  documents: InferInsertModel<typeof document>[];
  anchors: InferInsertModel<typeof anchor>[];
  orders: InferInsertModel<typeof order>[];
  listings: InferInsertModel<typeof listing>[];
  hearings: InferInsertModel<typeof hearing>[];
  obligations: InferInsertModel<typeof obligation>[];
  tasks: InferInsertModel<typeof task>[];
}

/** Every matter-graph row of the demo workspace for the seed day `today` (`yyyy-mm-dd`). */
export function demoMatterRows(ws: DemoWorkspaceSpec, today: string, at: Date): DemoMatterRows {
  const did = (kind: number, n: number) => demoId(kind, n, ws.index);
  const specs = matterSpecs(ws);
  const rows: DemoMatterRows = {
    matters: [],
    persons: [],
    roleEdges: [],
    proceedings: [],
    proceedingLinks: [],
    documents: [],
    anchors: [],
    orders: [],
    listings: [],
    hearings: [],
    obligations: [],
    tasks: [],
  };
  const stamp = { workspaceId: ws.id, createdAt: at, updatedAt: at };
  const fact = { ...stamp, ...demoProvenance(at) };
  const advocate = demoMember(ws, 'advocate');
  const counter = {
    proceeding: 0,
    listing: 0,
    hearing: 0,
    edge: 0,
    link: 0,
    obligation: 0,
    task: 0,
    document: 0,
  };
  const next = (key: keyof typeof counter) => ++counter[key];
  let caseSeq = 0;
  let activeIndex = 0;

  specs.forEach((spec, i) => {
    const n = i + 1;
    const matterId = did(ID_KIND.matter, n);
    const owner = demoMember(
      ws,
      spec.owner !== undefined && ws.members.includes(spec.owner) ? spec.owner : 'advocate',
    );
    const year = i % 3 === 0 ? 2025 : 2026;
    const client = fictional(spec.client);
    const opponent = fictional(spec.opponent);
    const [petitioner, respondent] = spec.clientIsPetitioner
      ? [client, opponent]
      : [opponent, client];

    rows.matters.push({
      id: matterId,
      ...stamp,
      title: `${petitioner} v. ${respondent}`,
      practiceArea: spec.area,
      status: spec.disposed ? 'disposed' : 'active',
      ownerMemberId: owner.memberId,
      openedAt: new Date(`${addDays(today, -120 - i * 7)}T10:00:00+05:30`),
    });

    // People: our client, the other side and their counsel.
    const clientId = did(ID_KIND.person, n * 10 + 1);
    const opponentId = did(ID_KIND.person, n * 10 + 2);
    const counselId = did(ID_KIND.person, n * 10 + 3);
    rows.persons.push(
      {
        id: clientId,
        ...fact,
        name: client,
        kind: 'client',
        contact: {
          email: `client${String(n)}@demo.causedeck.test`,
          phone: `+91 99999 00${String(100 + n)}`,
        },
      },
      { id: opponentId, ...fact, name: opponent, kind: 'party' },
      {
        id: counselId,
        ...fact,
        name:
          OPPOSING_ADVOCATES[ws.key][i % OPPOSING_ADVOCATES[ws.key].length] ?? fictional('Counsel'),
        kind: 'advocate',
      },
    );
    const edge = (
      values: Pick<
        InferInsertModel<typeof roleEdge>,
        'kind' | 'fromPersonId' | 'toPersonId' | 'matterId'
      >,
    ) => rows.roleEdges.push({ id: did(ID_KIND.roleEdge, next('edge')), ...fact, ...values });
    edge({ kind: 'instructed_by', fromPersonId: clientId, matterId });
    edge({ kind: 'opposes', fromPersonId: opponentId, toPersonId: clientId });
    edge({ kind: 'represents', fromPersonId: counselId, toPersonId: opponentId });

    // The main proceeding.
    const mainId = did(ID_KIND.proceeding, next('proceeding'));
    const seq = spec.srStage ? null : ++caseSeq;
    rows.proceedings.push({
      id: mainId,
      ...fact,
      matterId,
      forumId: forumId(ws, spec.forum),
      kind: 'main',
      caseTypeCode: spec.type,
      caseTypeRaw: spec.typeRaw,
      number: seq === null ? null : `DEMO-${String(seq).padStart(4, '0')}`,
      year: seq === null ? null : year,
      srNo: spec.srStage ? `SR-DEMO-${String(n).padStart(4, '0')}` : null,
      filingDate: addDays(today, -110 - i * 7),
      state: spec.disposed ? 'disposed' : spec.srStage ? 'sr_fr' : 'numbered',
      stateChangedAt: at,
      titlePetitioner: petitioner,
      titleRespondent: respondent,
    });
    const caseNumber =
      seq === null
        ? `${spec.type}-DEMO/SR/${String(n).padStart(4, '0')}`
        : demoCaseNumber(spec.type, year, seq);

    // The writ graph: two W.M.P.s under the W.P. and a W.A. against it.
    let appealId: string | null = null;
    if (i === 0 && ws.key === 'chennai-solo') {
      for (let k = 0; k < 2; k++) {
        const wmpId = did(ID_KIND.proceeding, next('proceeding'));
        const wmpSeq = ++caseSeq;
        rows.proceedings.push({
          id: wmpId,
          ...fact,
          matterId,
          forumId: forumId(ws, spec.forum),
          kind: 'misc',
          caseTypeCode: 'WMP',
          caseTypeRaw: 'W.M.P.',
          number: `DEMO-${String(wmpSeq).padStart(4, '0')}`,
          year,
          state: 'numbered',
          stateChangedAt: at,
          parentProceedingId: mainId,
          titlePetitioner: petitioner,
          titleRespondent: respondent,
        });
        rows.proceedingLinks.push({
          id: did(ID_KIND.proceedingLink, next('link')),
          ...fact,
          fromProceedingId: mainId,
          toProceedingId: wmpId,
          kind: 'parent_of',
        });
      }
      appealId = did(ID_KIND.proceeding, next('proceeding'));
      const waSeq = ++caseSeq;
      rows.proceedings.push({
        id: appealId,
        ...fact,
        matterId,
        forumId: forumId(ws, spec.forum),
        kind: 'appeal',
        caseTypeCode: 'WA',
        caseTypeRaw: 'W.A.',
        number: `DEMO-${String(waSeq).padStart(4, '0')}`,
        year: 2026,
        state: 'numbered',
        stateChangedAt: at,
        titlePetitioner: respondent,
        titleRespondent: petitioner,
      });
      rows.proceedingLinks.push({
        id: did(ID_KIND.proceedingLink, next('link')),
        ...fact,
        fromProceedingId: appealId,
        toProceedingId: mainId,
        kind: 'appeal_from',
      });
    }

    // Dates: two past listings with hearings, then the canonical next listing (active matters).
    const nextOffset = spec.disposed
      ? null
      : (NEXT_DATE_OFFSETS[activeIndex++ % NEXT_DATE_OFFSETS.length] ?? 7);
    const nextDate = nextOffset === null ? null : addDays(today, nextOffset);
    const earlier = addDays(today, -40 - (i % 6) * 3);
    const last = addDays(today, -3 - (i % 9) * 2);
    const listingBase = {
      ...fact,
      proceedingId: mainId,
      stageRaw: spec.stage,
      hallId: hallId(ws, spec.forum, i),
      benchId: benchId(ws, spec.forum, i),
    };
    const pastListing = (date: string, outcome: string, confirmed: string | null) => {
      const listingId = did(ID_KIND.listing, next('listing'));
      rows.listings.push({
        id: listingId,
        ...listingBase,
        listDate: date,
        listType: 'daily',
        listNo: 1,
        itemNo: String(10 + ((i * 7) % 60)),
      });
      rows.hearings.push({
        id: did(ID_KIND.hearing, next('hearing')),
        ...fact,
        listingId,
        heldOn: date,
        outcome,
        nextDateConfirmed: confirmed,
        stageAfterRaw: spec.stage,
      });
    };
    pastListing(earlier, HEARING_OUTCOMES[2] ?? '', last);
    pastListing(
      last,
      spec.disposed ? 'Disposed of; final order pronounced.' : (HEARING_OUTCOMES[i % 4] ?? ''),
      nextDate,
    );
    // A run of daily lists: one past listing per matter on a day of the last 30, so every day of
    // the month has lists in the workspace.
    pastListing(addDays(today, -1 - ((i * 7) % 30)), HEARING_OUTCOMES[(i + 1) % 4] ?? '', null);
    if (nextDate !== null && nextOffset !== null) {
      rows.listings.push({
        id: did(ID_KIND.listing, next('listing')),
        ...listingBase,
        listDate: nextDate,
        listType: nextOffset <= 1 ? 'daily' : 'advance',
        listNo: 1,
        itemNo: String(5 + ((i * 11) % 70)),
        canonical: true,
      });
    }
    if (appealId !== null) {
      rows.listings.push({
        id: did(ID_KIND.listing, next('listing')),
        ...listingBase,
        proceedingId: appealId,
        stageRaw: 'FOR ADMISSION',
        hallId: hallId(ws, spec.forum, 2),
        benchId: benchId(ws, spec.forum, 1),
        listDate: addDays(today, 9),
        listType: 'advance',
        canonical: true,
      });
    }

    // The orders: of the last hearing and, for two matters in three, an earlier interim order.
    // Each has its own PDF (SYNTHETIC watermark) and the anchor its direction cites.
    const orderRows: { orderId: string; anchorId: string; date: string }[] = [];
    const orderDates = [last, ...(i % 3 === 2 ? [] : [earlier])];
    orderDates.forEach((orderDate, k) => {
      const isLast = k === 0;
      const documentId = did(ID_KIND.document, ++counter.document);
      const anchorId = did(ID_KIND.anchor, counter.document);
      const orderId = did(ID_KIND.order, counter.document);
      const direction =
        isLast && spec.disposed
          ? 'The petition is disposed of. No costs.'
          : isLast
            ? `The ${spec.clientIsPetitioner ? 'respondent' : 'petitioner'} shall file a counter affidavit within two weeks; the petitioner may file a reply within one week thereafter.`
            : 'Notice to the respondents, returnable in four weeks. Interim directions to continue.';
      const orderType = isLast && spec.disposed ? 'final' : 'interim';
      const pdf = demoOrderPdf({
        caseNumber,
        title: `${orderType === 'final' ? 'Final' : 'Interim'} order dated ${orderDate}`,
        lines: [`${petitioner} v. ${respondent}`, direction],
      });
      rows.documents.push({
        id: documentId,
        ...stamp,
        kind: 'order',
        language: 'en',
        storageKey: `ws/${ws.id}/document/${String(at.getUTCFullYear())}/${documentId}`,
        sha256: pdf.sha256,
        textStatus: 'skipped',
        matterId,
      });
      rows.anchors.push({
        id: anchorId,
        ...stamp,
        documentId,
        pageNo: 1,
        quote: direction,
        kind: 'document',
      });
      const directions: OperativeDirection[] = [{ text: direction, anchorId }];
      rows.orders.push({
        id: orderId,
        ...fact,
        anchorId,
        proceedingId: mainId,
        documentId,
        orderDate,
        benchId: benchId(ws, spec.forum, i),
        orderType,
        operativeDirections: directions,
        nextDate: isLast ? nextDate : last,
      });
      orderRows.push({ orderId, anchorId, date: orderDate });
    });
    const { orderId, anchorId } = orderRows[0] as (typeof orderRows)[number];

    // Obligations: workspace-wide some overdue, some due today, some upcoming and some done.
    const obligationBase = {
      ...fact,
      matterId,
      proceedingId: mainId,
      ownerMemberId: owner.memberId,
    };
    const id = () => did(ID_KIND.obligation, next('obligation'));
    switch (i % 4) {
      case 0:
        rows.obligations.push({
          id: id(),
          ...obligationBase,
          source: 'order_direction',
          sourceOrderId: orderId,
          anchorId,
          description: 'File the counter affidavit directed by the court.',
          dueDate: addDays(today, -2 - (i % 5)),
          basis: `Order dated ${last}`,
        });
        break;
      case 1:
        rows.obligations.push({
          id: id(),
          ...obligationBase,
          source: 'certified_copy',
          description: 'Collect the certified copy of the last order.',
          dueDate: today,
        });
        break;
      case 2:
        rows.obligations.push({
          id: id(),
          ...obligationBase,
          source: 'registry_defect',
          description: 'Cure the registry defects and re-present the papers.',
          dueDate: addDays(today, 3 + (i % 10)),
        });
        break;
      default:
        rows.obligations.push({
          id: id(),
          ...obligationBase,
          source: 'order_direction',
          sourceOrderId: orderId,
          anchorId,
          description: 'Serve notice on the respondents and file proof of service.',
          dueDate: addDays(today, -10),
          status: 'done',
          closedReasonType: 'lawyer_action',
          closedBy: advocate.memberId,
          closedAt: at,
          closedNote: 'Proof of service filed.',
        });
    }
    // A certified copy or a registry defect on every matter, so the copy and defect lists are full.
    const copyOrDefect = i % 2 === 0;
    rows.obligations.push({
      id: id(),
      ...obligationBase,
      source: copyOrDefect ? 'certified_copy' : 'registry_defect',
      description: copyOrDefect
        ? `Apply for the certified copy of the order dated ${orderRows[orderRows.length - 1]?.date ?? last}.`
        : 'Rectify the objection raised by the registry and re-present.',
      dueDate: addDays(today, ((i * 5) % 14) - 4),
    });
    // A carry-forward item: left open at the last hearing and carried to the next date.
    rows.obligations.push({
      id: id(),
      ...obligationBase,
      source: 'internal',
      description: 'Carried forward from the last hearing: file the memo of citations.',
      basis: `Carry-forward from the hearing of ${last}`,
      ...(nextDate !== null ? { dueDate: addDays(nextDate, -2) } : {}),
      ...(spec.disposed
        ? {
            status: 'not_applicable' as const,
            closedReasonType: 'not_applicable' as const,
            closedBy: advocate.memberId,
            closedAt: at,
            closedNote: 'Matter disposed of; nothing to carry forward.',
          }
        : {}),
    });
    if (i % 3 === 0) {
      rows.obligations.push({
        id: id(),
        ...obligationBase,
        source: 'client',
        description: 'Get the signed vakalat and supporting documents from the client.',
        dueDate: addDays(today, 5 + (i % 7)),
      });
    }

    // A preparation task for the next date.
    if (nextDate !== null && i % 2 === 0) {
      rows.tasks.push({
        id: did(ID_KIND.task, next('task')),
        ...fact,
        matterId,
        proceedingId: mainId,
        title: 'Prepare the compilation and brief note for the next hearing.',
        dueDate: addDays(nextDate, -1),
        ownerMemberId: demoMember(ws, ws.members.includes('junior') ? 'junior' : 'advocate')
          .memberId,
      });
    }
  });
  return rows;
}
