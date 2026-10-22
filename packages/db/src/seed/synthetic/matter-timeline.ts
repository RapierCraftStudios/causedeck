// The synthetic matter for the Timeline tab (#41): one fictional Chennai matter with a six-
// proceeding graph (an appeal chain O.S. -> A.S. -> S.A., a W.P. with its W.A., and one proceeding
// still at the SR stage), twelve W.M.P. children under the W.P., and exactly 80 timeline events
// (listings, hearings, orders, obligations due and closed, state changes and documents). Stories,
// e2e and perf tests insert it into a workspace of their own, next to or instead of the matters
// set (matters.ts).
//
// A pure generator, like matters.ts: it returns rows for one workspace and writes nothing
// (`insertSyntheticMatterTimeline` in index.ts inserts them). Fictional only (names end in "(fictional)", case
// numbers are invented, no CNR), deterministic (ids derive from the workspace and a running number,
// dates are offsets from `today`, Asia/Kolkata), idempotent (`onConflictDoNothing`) and never in
// production. The 80 events: 16 listings, 10 hearings, 8 orders, 8 obligations due, 3 obligations
// closed, 13 state changes and 22 documents (8 of them the orders' own files).
import { createHash } from 'node:crypto';

import type { InferInsertModel } from 'drizzle-orm';

import type { hearing, listing, obligation, order } from '../../schema/docket.ts';
import type { anchor, document } from '../../schema/documents.ts';
import type { matter } from '../../schema/matter-graph.ts';
import type { person, roleEdge } from '../../schema/people.ts';
import type {
  proceeding,
  proceedingLink,
  proceedingStateChange,
} from '../../schema/proceedings.ts';

import { SYNTHETIC_FICTIONAL_SUFFIX } from './matters.ts';

export const SYNTHETIC_TIMELINE_EVENTS = 80;
export const SYNTHETIC_TIMELINE_PROCEEDINGS = 6;
export const SYNTHETIC_TIMELINE_MISC_CHILDREN = 12;

export interface SyntheticMatterTimelineOptions {
  workspaceId: string;
  forumId: string;
  /** The seed day (`yyyy-mm-dd`, Asia/Kolkata). */
  today: string;
  ownerMemberId?: string | null;
}

export interface SyntheticMatterTimeline {
  workspaceId: string;
  matterId: string;
  matters: InferInsertModel<typeof matter>[];
  persons: InferInsertModel<typeof person>[];
  roleEdges: InferInsertModel<typeof roleEdge>[];
  proceedings: InferInsertModel<typeof proceeding>[];
  proceedingLinks: InferInsertModel<typeof proceedingLink>[];
  documents: InferInsertModel<typeof document>[];
  anchors: InferInsertModel<typeof anchor>[];
  listings: InferInsertModel<typeof listing>[];
  hearings: InferInsertModel<typeof hearing>[];
  orders: InferInsertModel<typeof order>[];
  obligations: InferInsertModel<typeof obligation>[];
  stateChanges: InferInsertModel<typeof proceedingStateChange>[];
}

type State = InferInsertModel<typeof proceeding>['state'] & string;

interface Plan {
  key: string;
  kind: 'main' | 'appeal';
  code: string;
  raw: string;
  number: string | null;
  year: number | null;
  srNo?: string;
  /** The states after `filed`, in order. */
  states: readonly State[];
  listings: number;
  orders: number;
  /** Documents besides the order files. */
  docs: number;
  /** The proceeding this one appeals from. */
  appealOf?: string;
}

const PLANS: readonly Plan[] = [
  {
    key: 'os',
    kind: 'main',
    code: 'OS',
    raw: 'O.S.',
    number: '31',
    year: 2024,
    states: ['sr_fr', 'defects', 're_presented', 'numbered'],
    listings: 2,
    orders: 1,
    docs: 2,
  },
  {
    key: 'as',
    kind: 'appeal',
    code: 'AS',
    raw: 'A.S.',
    number: '72',
    year: 2025,
    states: ['sr_fr', 'numbered'],
    listings: 2,
    orders: 1,
    docs: 2,
    appealOf: 'os',
  },
  {
    key: 'sa',
    kind: 'appeal',
    code: 'SA',
    raw: 'S.A.',
    number: '9',
    year: 2026,
    states: ['sr_fr', 'numbered'],
    listings: 1,
    orders: 1,
    docs: 1,
    appealOf: 'as',
  },
  {
    key: 'wp',
    kind: 'main',
    code: 'WP',
    raw: 'W.P.',
    number: '678',
    year: 2026,
    states: ['sr_fr', 'numbered'],
    listings: 6,
    orders: 3,
    docs: 5,
  },
  {
    key: 'wa',
    kind: 'appeal',
    code: 'WA',
    raw: 'W.A.',
    number: '12',
    year: 2026,
    states: ['sr_fr', 'numbered'],
    listings: 4,
    orders: 2,
    docs: 2,
    appealOf: 'wp',
  },
  {
    key: 'sr',
    kind: 'main',
    code: 'WP',
    raw: 'W.P.',
    number: null,
    year: null,
    srNo: 'SR-SYN-5678',
    states: ['sr_fr'],
    listings: 1,
    orders: 0,
    docs: 2,
  },
];

const DOCUMENT_KINDS = ['pleading', 'annexure', 'correspondence', 'note', 'ia'] as const;

function fixedId(workspaceId: string, kind: string, n: number): string {
  const hex = createHash('sha256')
    .update(`synthetic:matter-timeline:${workspaceId}:${kind}:${String(n)}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The rows of the synthetic timeline matter for `workspaceId`. */
export function syntheticMatterTimeline(
  options: SyntheticMatterTimelineOptions,
): SyntheticMatterTimeline {
  const { workspaceId, forumId, today, ownerMemberId = null } = options;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new TypeError(`syntheticMatterTimeline: bad day ${today}`);
  }
  const id = (kind: string, n: number) => fixedId(workspaceId, kind, n);
  const at = (day: string, time = '10:00:00') => new Date(`${day}T${time}+05:30`);
  const stamp = at(addDays(today, -400));
  const system = (ref: string) => ({
    sourceType: 'system' as const,
    sourceRef: `seed:synthetic:matter-timeline:${ref}`,
    confirmationState: 'confirmed' as const,
    capturedAt: stamp,
  });
  const fictional = (name: string) => `${name}${SYNTHETIC_FICTIONAL_SUFFIX}`;
  const matterId = id('matter', 1);
  const client = fictional('Ilakkiya Senthil');
  const opponent = fictional('Neithal Shipping Agencies');

  const out: SyntheticMatterTimeline = {
    workspaceId,
    matterId,
    matters: [
      {
        id: matterId,
        workspaceId,
        title: `${client} v. ${opponent}`,
        practiceArea: 'writ',
        status: 'active',
        sensitive: false,
        ownerMemberId,
        openedAt: stamp,
        createdAt: stamp,
        updatedAt: stamp,
      },
    ],
    persons: [],
    roleEdges: [],
    proceedings: [],
    proceedingLinks: [],
    documents: [],
    anchors: [],
    listings: [],
    hearings: [],
    orders: [],
    obligations: [],
    stateChanges: [],
  };

  const clientId = id('person', 1);
  out.persons.push(
    {
      id: clientId,
      workspaceId,
      name: client,
      kind: 'client',
      contact: { email: 'client-matter-timeline@synthetic.test' },
      ...system('person:client'),
    },
    { id: id('person', 2), workspaceId, name: opponent, kind: 'party', ...system('person:party') },
  );
  out.roleEdges.push({
    id: id('role_edge', 1),
    workspaceId,
    kind: 'instructed_by',
    fromPersonId: clientId,
    matterId,
    ...system('role:client'),
  });

  const procId = new Map<string, string>();
  let docN = 0;
  let listingN = 0;
  let orderN = 0;
  let hearingN = 0;
  let stateN = 0;
  const pastListings: { id: string; day: string }[] = [];
  const addDocument = (kind: (typeof DOCUMENT_KINDS)[number] | 'order', day: string) => {
    docN += 1;
    const docId = id('document', docN);
    out.documents.push({
      id: docId,
      workspaceId,
      matterId,
      kind,
      language: 'en',
      storageKey: `ws/${workspaceId}/synthetic/matter-timeline/${String(docN)}.pdf`,
      sha256: createHash('sha256')
        .update(`synthetic-doc:${String(docN)}`)
        .digest('hex'),
      textStatus: 'layer',
      createdAt: at(day, '11:00:00'),
      updatedAt: at(day, '11:00:00'),
    });
    return docId;
  };

  PLANS.forEach((plan, p) => {
    const proceedingId = id('proceeding', p + 1);
    procId.set(plan.key, proceedingId);
    const base = -330 + p * 25;
    const lastState = plan.states[plan.states.length - 1] ?? 'filed';
    out.proceedings.push({
      id: proceedingId,
      workspaceId,
      matterId,
      forumId,
      kind: plan.kind,
      caseTypeCode: plan.code,
      caseTypeRaw: plan.raw,
      ...(plan.number === null ? {} : { number: plan.number }),
      ...(plan.year === null ? {} : { year: plan.year }),
      ...(plan.srNo === undefined ? {} : { srNo: plan.srNo }),
      state: lastState,
      titlePetitioner: client,
      titleRespondent: opponent,
      createdAt: at(addDays(today, base)),
      updatedAt: at(addDays(today, base)),
      ...system(`proceeding:${plan.key}`),
    });

    let from: State = 'filed';
    plan.states.forEach((to, k) => {
      stateN += 1;
      out.stateChanges.push({
        id: id('state_change', stateN),
        workspaceId,
        proceedingId,
        fromState: from,
        toState: to,
        ...(to === 'defects'
          ? {
              reason: 'Defects notified by the registry (fictional)',
              cureDeadline: addDays(today, base + k * 6 + 7),
            }
          : {}),
        changedAt: at(addDays(today, base + k * 6)),
        ...system(`state:${String(stateN)}`),
      });
      from = to;
    });

    for (let l = 0; l < plan.listings; l++) {
      listingN += 1;
      const future = (plan.key === 'wp' || plan.key === 'wa') && l === plan.listings - 1;
      const day = future
        ? addDays(today, plan.key === 'wp' ? 9 : 30)
        : addDays(today, base + 14 + l * 20);
      const listingId = id('listing', listingN);
      out.listings.push({
        id: listingId,
        workspaceId,
        proceedingId,
        listDate: day,
        listType: 'daily',
        stageRaw: future ? 'FOR HEARING' : 'FOR ORDERS',
        canonical: future && plan.key === 'wp',
        ...system(`listing:${String(listingN)}`),
      });
      if (!future) pastListings.push({ id: listingId, day });
    }

    for (let o = 0; o < plan.orders; o++) {
      orderN += 1;
      const day = addDays(today, base + 16 + o * 20);
      const documentId = addDocument('order', day);
      const anchorId = id('anchor', orderN);
      out.anchors.push({
        id: anchorId,
        workspaceId,
        documentId,
        pageNo: 1 + (o % 3),
        quote: `Order ${String(orderN)}: the matter is adjourned (fictional).`,
        kind: 'document',
        createdAt: at(day),
        updatedAt: at(day),
      });
      out.orders.push({
        id: id('order', orderN),
        workspaceId,
        proceedingId,
        documentId,
        orderDate: day,
        orderType: o % 2 === 0 ? 'interim' : 'final',
        sourceType: 'document',
        anchorId,
        confidence: '0.940',
        confirmationState: 'confirmed',
        capturedAt: at(day),
      });
    }

    for (let d = 0; d < plan.docs; d++) {
      addDocument(
        DOCUMENT_KINDS[(p + d) % DOCUMENT_KINDS.length] ?? 'note',
        addDays(today, base + 3 + d * 11),
      );
    }
  });

  // Hearings on the first ten past listings; two of them still proposed, not confirmed.
  pastListings.slice(0, 10).forEach((past, h) => {
    hearingN += 1;
    out.hearings.push({
      id: id('hearing', hearingN),
      workspaceId,
      listingId: past.id,
      heldOn: past.day,
      adjournmentReason: 'Counsel sought time (fictional)',
      nextDateProposed: addDays(past.day, 14),
      ...(h % 5 === 2
        ? {
            sourceType: 'ai' as const,
            sourceRef: `seed:synthetic:matter-timeline:hearing:${String(hearingN)}`,
            confidence: '0.740',
            confirmationState: 'proposed' as const,
            capturedAt: at(past.day),
          }
        : { ...system(`hearing:${String(hearingN)}`), capturedAt: at(past.day) }),
    });
  });

  // Eight obligations due, three of them closed.
  const wp = procId.get('wp');
  for (let i = 1; i <= 8; i++) {
    const closed = i <= 3;
    out.obligations.push({
      id: id('obligation', i),
      workspaceId,
      matterId,
      ...(wp === undefined ? {} : { proceedingId: wp }),
      source: 'order_direction',
      description: `File the counter affidavit, part ${String(i)} (fictional)`,
      dueDate: addDays(today, i * 12 - 100),
      ...(closed
        ? {
            status: 'done' as const,
            closedReasonType: 'task_completed' as const,
            closedAt: at(addDays(today, i * 12 - 104)),
          }
        : {}),
      ...system(`obligation:${String(i)}`),
    });
  }

  const link = (n: number, kind: 'appeal_from' | 'connected', from: string, to: string) => {
    const fromId = procId.get(from);
    const toId = procId.get(to);
    if (fromId === undefined || toId === undefined) return;
    out.proceedingLinks.push({
      id: id('proceeding_link', n),
      workspaceId,
      fromProceedingId: fromId,
      toProceedingId: toId,
      kind,
      ...system(`link:${String(n)}`),
    });
  };
  PLANS.forEach((plan, i) => {
    if (plan.appealOf !== undefined) link(i + 1, 'appeal_from', plan.key, plan.appealOf);
  });
  link(10, 'connected', 'wp', 'os');

  // Twelve miscellaneous (W.M.P.) children under the W.P., still without a number.
  const parent = procId.get('wp');
  for (let c = 1; c <= SYNTHETIC_TIMELINE_MISC_CHILDREN; c++) {
    out.proceedings.push({
      id: id('proceeding', 100 + c),
      workspaceId,
      matterId,
      forumId,
      kind: 'misc',
      caseTypeCode: 'WMP',
      caseTypeRaw: 'W.M.P.',
      srNo: `SR-SYN-WMP-${String(c)}`,
      state: 'sr_fr',
      ...(parent === undefined ? {} : { parentProceedingId: parent }),
      titlePetitioner: client,
      titleRespondent: opponent,
      createdAt: at(addDays(today, -200 + c)),
      updatedAt: at(addDays(today, -200 + c)),
      ...system(`proceeding:wmp:${String(c)}`),
    });
  }
  return out;
}

/** How many timeline events the rows make (`getMatterTimeline` with no filter). */
export function syntheticTimelineEventCount(set: SyntheticMatterTimeline): number {
  return (
    set.listings.length +
    set.hearings.length +
    set.orders.length +
    set.obligations.filter((o) => o.dueDate != null).length +
    set.obligations.filter((o) => o.status === 'done').length +
    set.stateChanges.length +
    set.documents.length
  );
}
