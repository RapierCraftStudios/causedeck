// Matters of the demo seed (#182): 25 fictional matters, 13 before the Madras High Court and 12
// before the Bengaluru courts (City Civil Court, High Court of Karnataka), covering writ, civil suit,
// bail, arbitration and family. Each matter gets a client and an opposing party, its proceedings, a
// past hearing, a canonical next listing (some today and tomorrow), an order with a generated PDF,
// obligations and tasks. Every date is an offset from the seed day.
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
import { addDays, DEMO_WORKSPACE_ID, demoId, demoProvenance, ID_KIND } from './shared.ts';

export type DemoPracticeArea = 'writ' | 'civil_suit' | 'bail' | 'arbitration' | 'family';

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

/** The 25 matters. Index 0 is the writ graph: a W.P. with two W.M.P.s and a W.A. against it. */
// prettier-ignore
const MATTERS: readonly MatterSpec[] = [
  // Madras High Court (13)
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
  // City Civil Court, Bengaluru (5)
  { forum: 'ccc', area: 'civil_suit', type: 'OS', typeRaw: 'O.S.', client: 'Chiranth Hosmane', clientIsPetitioner: true, opponent: 'Vismaya Developers Pvt. Ltd.', stage: 'PLAINTIFF EVIDENCE' },
  { forum: 'ccc', area: 'civil_suit', type: 'OS', typeRaw: 'O.S.', client: 'Sanvi Kanthiraj', clientIsPetitioner: false, opponent: 'Nuthan Shettigar', stage: 'FOR WRITTEN STATEMENT', owner: 'junior' },
  { forum: 'ccc', area: 'civil_suit', type: 'OS', typeRaw: 'O.S.', client: 'Tejas Malnad Stores', clientIsPetitioner: true, opponent: 'Hamsa Leasing Co.', stage: 'DISPOSED', disposed: true },
  { forum: 'ccc', area: 'arbitration', type: 'COMAS', typeRaw: 'Com.A.S.', client: 'Ishwari Infra Projects', clientIsPetitioner: true, opponent: 'Prerana Power Systems Ltd.', stage: 'FOR ARGUMENTS' },
  { forum: 'ccc', area: 'arbitration', type: 'COMAS', typeRaw: 'Com.A.S.', client: 'Kanthi Software Services', clientIsPetitioner: false, opponent: 'Manasa Facility Management', stage: 'FOR OBJECTIONS' },
  // High Court of Karnataka (7)
  { forum: 'khc', area: 'writ', type: 'WP', typeRaw: 'W.P.', client: 'Hosmane Gram Vikas Samithi', clientIsPetitioner: true, opponent: 'Demo Urban Development Department', stage: 'PRELIMINARY HEARING' },
  { forum: 'khc', area: 'writ', type: 'WP', typeRaw: 'W.P.', client: 'Sharavathi Bus Operators', clientIsPetitioner: true, opponent: 'Demo Transport Authority', stage: 'FOR ORDERS', owner: 'junior' },
  { forum: 'khc', area: 'bail', type: 'CRLP', typeRaw: 'Crl.P.', client: 'Nuthan Gowdru', clientIsPetitioner: true, opponent: 'Demo Halli Police Station', stage: 'BAIL' },
  { forum: 'khc', area: 'bail', type: 'CRLP', typeRaw: 'Crl.P.', client: 'Vismaya Hegganna', clientIsPetitioner: true, opponent: 'Demo Pete Police Station', stage: 'BAIL' },
  { forum: 'khc', area: 'bail', type: 'CRLP', typeRaw: 'Crl.P.', client: 'Prerana Tunga', clientIsPetitioner: true, opponent: 'Demo Kere Police Station', stage: 'ANTICIPATORY BAIL' },
  { forum: 'khc', area: 'family', type: 'MFA', typeRaw: 'M.F.A.', client: 'Manasa Chiranth', clientIsPetitioner: true, opponent: 'Chiranth Basavaraju', stage: 'FOR ADMISSION' },
  { forum: 'khc', area: 'family', type: 'MFA', typeRaw: 'M.F.A.', client: 'Hamsa Kaveri', clientIsPetitioner: false, opponent: 'Kaveri Ranganatha', stage: 'FOR HEARING' },
];

export const DEMO_MATTER_COUNT = MATTERS.length;

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
export function demoMatterRows(today: string, at: Date): DemoMatterRows {
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
  const ws = DEMO_WORKSPACE_ID;
  const stamp = { workspaceId: ws, createdAt: at, updatedAt: at };
  const fact = { ...stamp, ...demoProvenance(at) };
  const advocate = demoMember('advocate');
  const counter = {
    proceeding: 0,
    listing: 0,
    hearing: 0,
    edge: 0,
    link: 0,
    obligation: 0,
    task: 0,
  };
  const next = (key: keyof typeof counter) => ++counter[key];
  let caseSeq = 0;
  let activeIndex = 0;

  MATTERS.forEach((spec, i) => {
    const n = i + 1;
    const matterId = demoId(ID_KIND.matter, n);
    const owner = demoMember(spec.owner ?? 'advocate');
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
    const clientId = demoId(ID_KIND.person, n * 10 + 1);
    const opponentId = demoId(ID_KIND.person, n * 10 + 2);
    const counselId = demoId(ID_KIND.person, n * 10 + 3);
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
        name: OPPOSING_ADVOCATES[i % OPPOSING_ADVOCATES.length] ?? fictional('Counsel'),
        kind: 'advocate',
      },
    );
    const edge = (
      values: Pick<
        InferInsertModel<typeof roleEdge>,
        'kind' | 'fromPersonId' | 'toPersonId' | 'matterId'
      >,
    ) => rows.roleEdges.push({ id: demoId(ID_KIND.roleEdge, next('edge')), ...fact, ...values });
    edge({ kind: 'instructed_by', fromPersonId: clientId, matterId });
    edge({ kind: 'opposes', fromPersonId: opponentId, toPersonId: clientId });
    edge({ kind: 'represents', fromPersonId: counselId, toPersonId: opponentId });

    // The main proceeding.
    const mainId = demoId(ID_KIND.proceeding, next('proceeding'));
    const seq = spec.srStage ? null : ++caseSeq;
    rows.proceedings.push({
      id: mainId,
      ...fact,
      matterId,
      forumId: forumId(spec.forum),
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
    if (i === 0) {
      for (let k = 0; k < 2; k++) {
        const wmpId = demoId(ID_KIND.proceeding, next('proceeding'));
        const wmpSeq = ++caseSeq;
        rows.proceedings.push({
          id: wmpId,
          ...fact,
          matterId,
          forumId: forumId(spec.forum),
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
          id: demoId(ID_KIND.proceedingLink, next('link')),
          ...fact,
          fromProceedingId: mainId,
          toProceedingId: wmpId,
          kind: 'parent_of',
        });
      }
      appealId = demoId(ID_KIND.proceeding, next('proceeding'));
      const waSeq = ++caseSeq;
      rows.proceedings.push({
        id: appealId,
        ...fact,
        matterId,
        forumId: forumId(spec.forum),
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
        id: demoId(ID_KIND.proceedingLink, next('link')),
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
      hallId: hallId(spec.forum, i),
      benchId: benchId(spec.forum, i),
    };
    const pastListing = (date: string, outcome: string, confirmed: string | null) => {
      const listingId = demoId(ID_KIND.listing, next('listing'));
      rows.listings.push({
        id: listingId,
        ...listingBase,
        listDate: date,
        listType: 'daily',
        listNo: 1,
        itemNo: String(10 + ((i * 7) % 60)),
      });
      rows.hearings.push({
        id: demoId(ID_KIND.hearing, next('hearing')),
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
    if (nextDate !== null && nextOffset !== null) {
      rows.listings.push({
        id: demoId(ID_KIND.listing, next('listing')),
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
        id: demoId(ID_KIND.listing, next('listing')),
        ...listingBase,
        proceedingId: appealId,
        stageRaw: 'FOR ADMISSION',
        hallId: hallId(spec.forum, 2),
        benchId: benchId(spec.forum, 1),
        listDate: addDays(today, 9),
        listType: 'advance',
        canonical: true,
      });
    }

    // The order of the last hearing, its PDF and the anchor its direction cites.
    const documentId = demoId(ID_KIND.document, n);
    const anchorId = demoId(ID_KIND.anchor, n);
    const orderId = demoId(ID_KIND.order, n);
    const direction = spec.disposed
      ? 'The petition is disposed of. No costs.'
      : `The ${spec.clientIsPetitioner ? 'respondent' : 'petitioner'} shall file a counter affidavit within two weeks; the petitioner may file a reply within one week thereafter.`;
    const orderType = spec.disposed ? 'final' : 'interim';
    const pdf = demoOrderPdf({
      caseNumber,
      title: `${orderType === 'final' ? 'Final' : 'Interim'} order dated ${last}`,
      lines: [`${petitioner} v. ${respondent}`, direction],
    });
    rows.documents.push({
      id: documentId,
      ...stamp,
      kind: 'order',
      language: 'en',
      storageKey: `ws/${ws}/document/${String(at.getUTCFullYear())}/${documentId}`,
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
      orderDate: last,
      benchId: benchId(spec.forum, i),
      orderType,
      operativeDirections: directions,
      nextDate,
    });

    // Obligations: workspace-wide some overdue, some due today, some upcoming and some done.
    const obligationBase = {
      ...fact,
      matterId,
      proceedingId: mainId,
      ownerMemberId: owner.memberId,
    };
    const id = () => demoId(ID_KIND.obligation, next('obligation'));
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
        id: demoId(ID_KIND.task, next('task')),
        ...fact,
        matterId,
        proceedingId: mainId,
        title: 'Prepare the compilation and brief note for the next hearing.',
        dueDate: addDays(nextDate, -1),
        ownerMemberId: demoMember('junior').memberId,
      });
    }
  });
  return rows;
}
