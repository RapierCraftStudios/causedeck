// The product modules of the demo seed beyond the matter graph (#985): contacts, the enquiry log with
// a conflict card, a list diff, an order with an unreconciled direction, a junior handover with
// delegated appearances, brief state and the court-day marker, fees and the client ledger,
// limitation, a client status link, outward drafts, the drafting studio, the capture inbox, notices
// in the bell, issue tags, research notes, registry defects and certified copies, proof-of-value
// ratings and a recovery portfolio. Every row is plain data (nothing here is encrypted: memory and
// the sample PDFs are written by `@causedeck/core`'s `seed:demo:content`, see demo-seed.md), fictional,
// `SYNTHETIC`-marked where it carries text, deterministic (fixed ids, dates are offsets from the seed
// day) and never outward-sending: a demo workspace is `is_demo`.
import { createHash } from 'node:crypto';

import type { InferInsertModel, Table } from 'drizzle-orm';

import type { courtHall } from '../../schema/court.ts';
import type { appearance, obligation, order, OperativeDirection } from '../../schema/docket.ts';
import type { anchor, document } from '../../schema/documents.ts';
import type { capture } from '../../schema/capture.ts';
import type { clientContact } from '../../schema/client-contact.ts';
import type { draft, draftVersion, template } from '../../schema/drafting.ts';
import type { conflictCheckResult, enquiry, enquiryParty } from '../../schema/enquiry.ts';
import type {
  clientLedgerEntry,
  feeAgreement,
  feeInvoice,
  feeInvoiceLine,
  payment,
} from '../../schema/fees.ts';
import type { handoverNote, matterView } from '../../schema/continuity.ts';
import type { limitationComputation, limitationRule } from '../../schema/limitation.ts';
import type { matterIssueTag } from '../../schema/matter-issue.ts';
import type { notification } from '../../schema/notifications.ts';
import type { certifiedCopy, defect, obligationEvent } from '../../schema/obligation-tracking.ts';
import type { outwardDraft, outwardDraftVersion } from '../../schema/outward-draft.ts';
import type { portfolio, portfolioCase } from '../../schema/portfolio.ts';
import type { loadPulse, preparednessRating } from '../../schema/proof-of-value.ts';
import type { proposal } from '../../schema/automation.ts';
import type { researchNote } from '../../schema/research-note.ts';
import type { statusLink } from '../../schema/status-link.ts';
import type { briefState } from '../../schema/brief.ts';
import type { courtDayMarker, listSnapshot } from '../../schema/court-day.ts';
import type { roleEdge } from '../../schema/people.ts';

import type { DemoCourtRows } from './courts.ts';
import { demoCourtRows } from './courts.ts';
import { demoMatterRows } from './matters.ts';
import { demoOrderPdf, type DemoPdfInput } from './pdf.ts';
import { demoMember, fictional } from './people.ts';
import type { DemoMatterRows } from './matters.ts';
import { addDays, demoId, demoProvenance, ID_KIND } from './shared.ts';
import type { DemoWorkspaceSpec } from './workspaces.ts';

type Insert<T extends Table> = InferInsertModel<T>;

export interface DemoModuleRows {
  contacts: Insert<typeof clientContact>[];
  roleEdges: Insert<typeof roleEdge>[];
  enquiries: Insert<typeof enquiry>[];
  enquiryParties: Insert<typeof enquiryParty>[];
  conflictResults: Insert<typeof conflictCheckResult>[];
  snapshots: Insert<typeof listSnapshot>[];
  markers: Insert<typeof courtDayMarker>[];
  briefStates: Insert<typeof briefState>[];
  /** The order with an unreconciled direction, its document, anchors and obligations. */
  documents: Insert<typeof document>[];
  anchors: Insert<typeof anchor>[];
  orders: Insert<typeof order>[];
  obligations: Insert<typeof obligation>[];
  /** Input of every extra sample PDF, by document id. */
  pdfs: { documentId: string; input: DemoPdfInput }[];
  handovers: Insert<typeof handoverNote>[];
  matterViews: Insert<typeof matterView>[];
  appearances: Insert<typeof appearance>[];
  ratings: Insert<typeof preparednessRating>[];
  pulses: Insert<typeof loadPulse>[];
  agreements: Insert<typeof feeAgreement>[];
  invoices: Insert<typeof feeInvoice>[];
  invoiceLines: Insert<typeof feeInvoiceLine>[];
  payments: Insert<typeof payment>[];
  ledger: Insert<typeof clientLedgerEntry>[];
  limitationRules: Insert<typeof limitationRule>[];
  limitationComputations: Insert<typeof limitationComputation>[];
  statusLinks: Insert<typeof statusLink>[];
  outwardDrafts: Insert<typeof outwardDraft>[];
  outwardVersions: Insert<typeof outwardDraftVersion>[];
  templates: Insert<typeof template>[];
  drafts: Insert<typeof draft>[];
  draftVersions: Insert<typeof draftVersion>[];
  captures: Insert<typeof capture>[];
  proposals: Insert<typeof proposal>[];
  notifications: Insert<typeof notification>[];
  issueTags: Insert<typeof matterIssueTag>[];
  researchNotes: Insert<typeof researchNote>[];
  defects: Insert<typeof defect>[];
  certifiedCopies: Insert<typeof certifiedCopy>[];
  obligationEvents: Insert<typeof obligationEvent>[];
  portfolios: Insert<typeof portfolio>[];
  portfolioCases: Insert<typeof portfolioCase>[];
}

/** The fixed token of the demo status link: public by design (it is fictional and expires). */
/** Every sample PDF of the workspace: its document, object key and bytes (stable for the same day). */
export function demoDocumentPdfs(
  ws: DemoWorkspaceSpec,
  today: string,
  at: Date,
): {
  documentId: string;
  storageKey: string;
  filename: string;
  bytes: Uint8Array;
  sha256: string;
}[] {
  const courts = demoCourtRows(ws, at);
  const graph = demoMatterRows(ws, today, at);
  const mod = demoModuleRows(ws, today, at, graph, courts);
  return [...graph.pdfs, ...mod.pdfs].map(({ documentId, input }) => {
    const pdf = demoOrderPdf(input);
    return {
      documentId,
      storageKey: `ws/${ws.id}/document/${String(at.getUTCFullYear())}/${documentId}`,
      filename: `${input.caseNumber.replaceAll('/', '-')}-order.pdf`,
      bytes: pdf.bytes,
      sha256: pdf.sha256,
    };
  });
}

export const DEMO_STATUS_LINK_TOKEN = 'demo-status-link-synthetic-0001';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

type Hall = Insert<typeof courtHall>;

const ENQUIRERS: Record<DemoWorkspaceSpec['key'], readonly string[]> = {
  'chennai-solo': [
    'Mahizhan Aadhi',
    'Thenmozhi Karuvel',
    'Pugazh Neythal',
    'Aathira Senkodi',
    'Vanavil Marutham',
  ],
  'bengaluru-chamber': [
    'Sahyadri Manjunath',
    'Kaveri Rangappa',
    'Bhoomika Nandi',
    'Dharani Gundlupet',
    'Anaadi Karekal',
  ],
};

/** Every module row of the demo workspace for the seed day `today`. */
export function demoModuleRows(
  ws: DemoWorkspaceSpec,
  today: string,
  at: Date,
  graph: DemoMatterRows,
  courts: DemoCourtRows,
): DemoModuleRows {
  const did = (kind: number, n: number) => demoId(kind, n, ws.index);
  const advocate = demoMember(ws, 'advocate');
  const junior = ws.members.includes('junior') ? demoMember(ws, 'junior') : advocate;
  const stamp = { workspaceId: ws.id, createdAt: at, updatedAt: at };
  const fact = { ...stamp, ...demoProvenance(at) };
  const yesterday = addDays(today, -1);
  const rows: DemoModuleRows = {
    contacts: [],
    roleEdges: [],
    enquiries: [],
    enquiryParties: [],
    conflictResults: [],
    snapshots: [],
    markers: [],
    briefStates: [],
    documents: [],
    anchors: [],
    orders: [],
    obligations: [],
    pdfs: [],
    handovers: [],
    matterViews: [],
    appearances: [],
    ratings: [],
    pulses: [],
    agreements: [],
    invoices: [],
    invoiceLines: [],
    payments: [],
    ledger: [],
    limitationRules: [],
    limitationComputations: [],
    statusLinks: [],
    outwardDrafts: [],
    outwardVersions: [],
    templates: [],
    drafts: [],
    draftVersions: [],
    captures: [],
    proposals: [],
    notifications: [],
    issueTags: [],
    researchNotes: [],
    defects: [],
    certifiedCopies: [],
    obligationEvents: [],
    portfolios: [],
    portfolioCases: [],
  };

  const mainOf = (matterId: string) =>
    graph.proceedings.find((p) => p.matterId === matterId && p.kind === 'main');
  const matterAt = (i: number) => graph.matters[i] as (typeof graph.matters)[number];
  const clientOf = (i: number) =>
    graph.persons.find((p) => p.id === did(ID_KIND.person, (i + 1) * 10 + 1));
  const opponentOf = (i: number) =>
    graph.persons.find((p) => p.id === did(ID_KIND.person, (i + 1) * 10 + 2));
  const activeIdx = graph.matters
    .map((m, i) => (m.status === 'disposed' ? -1 : i))
    .filter((i) => i >= 0);

  // Every matter: the chamber represents the client and the other side opposes, as role edges on
  // the matter, so the conflict check finds them (it reads `represents` and `opposes` edges).
  graph.matters.forEach((m, i) => {
    const c = clientOf(i);
    const o = opponentOf(i);
    if (c === undefined || o === undefined) return;
    rows.roleEdges.push(
      {
        id: did(ID_KIND.roleEdge, 5000 + i * 2 + 1),
        ...fact,
        kind: 'represents',
        fromPersonId: c.id as string,
        matterId: m.id,
      },
      {
        id: did(ID_KIND.roleEdge, 5000 + i * 2 + 2),
        ...fact,
        kind: 'opposes',
        fromPersonId: o.id as string,
        matterId: m.id,
      },
    );
  });

  // People: reachable contacts of the first twelve clients.
  const lang = ws.key === 'chennai-solo' ? 'ta' : 'kn';
  graph.matters.slice(0, 12).forEach((_m, i) => {
    const c = clientOf(i);
    if (c === undefined) return;
    rows.contacts.push({
      id: did(ID_KIND.clientContact, i + 1),
      ...stamp,
      personId: c.id as string,
      kind: 'primary',
      phone: `+9199999${String(101 + i).padStart(5, '0')}`,
      email: `client${String(i + 1)}@demo.causedeck.test`,
      languagePref: i % 3 === 0 ? 'en' : lang,
      createdBy: advocate.id,
    });
  });

  // Enquiries and the conflict card: a prospective client who wants to act against an existing
  // client (a hit), one with a near-spelling hit, one clear, one declined, one referred, one closed.
  const enquirers = ENQUIRERS[ws.key];
  const hitIdx = activeIdx[2] ?? 2;
  const nearIdx = activeIdx[5] ?? 5;
  const hitClient = clientOf(hitIdx)?.name as string;
  const nearClient = clientOf(nearIdx)?.name as string;
  const hitMatter = matterAt(hitIdx);
  const nearMatter = matterAt(nearIdx);
  const enq: {
    status: string;
    channel: string;
    summary: string;
    area: string;
    days: number;
    adverse: string;
    hits: number;
  }[] = [
    {
      status: 'checked',
      channel: 'phone',
      summary:
        'Wants to challenge a recovery notice served by a lender. Synthetic enquiry for the demo.',
      area: 'civil_suit',
      days: 1,
      adverse: hitClient,
      hits: 2,
    },
    {
      status: 'logged',
      channel: 'walk_in',
      summary: 'Tenancy dispute over a shop, eviction notice received. Synthetic enquiry.',
      area: 'civil_suit',
      days: 0,
      adverse: fictional('Nandana Rental Trust'),
      hits: -1,
    },
    {
      status: 'checked',
      channel: 'email',
      summary: 'Cheque dishonour complaint to be filed. Synthetic enquiry.',
      area: 'magistrate',
      days: 3,
      adverse: fictional('Kalinga Hardware Mart'),
      hits: 0,
    },
    {
      status: 'declined',
      channel: 'referral',
      summary: 'Matter outside the practice areas of the chamber. Synthetic enquiry.',
      area: 'writ',
      days: 9,
      adverse: fictional('Demo Revenue Department'),
      hits: -1,
    },
    {
      status: 'referred',
      channel: 'web',
      summary: 'Consumer complaint; referred to a colleague. Synthetic enquiry.',
      area: 'civil_suit',
      days: 12,
      adverse: fictional('Urvi Appliances Ltd.'),
      hits: -1,
    },
  ];
  enq.forEach((e, k) => {
    const eid = did(ID_KIND.enquiry, k + 1);
    const received = new Date(`${addDays(today, -e.days)}T11:00:00+05:30`);
    const name = fictional(enquirers[k] ?? `Enquirer ${String(k + 1)}`);
    rows.enquiries.push({
      id: eid,
      ...stamp,
      status: e.status,
      channel: e.channel,
      enquirerName: name,
      phone: `+9199999${String(900 + k).padStart(5, '0')}`,
      email: `enquiry${String(k + 1)}@demo.causedeck.test`,
      summary: e.summary,
      practiceArea: e.area,
      receivedAt: received,
      createdBy: advocate.id,
    });
    rows.enquiryParties.push(
      { id: did(ID_KIND.enquiryParty, k * 2 + 1), ...stamp, enquiryId: eid, name, side: 'client' },
      {
        id: did(ID_KIND.enquiryParty, k * 2 + 2),
        ...stamp,
        enquiryId: eid,
        name: e.adverse,
        side: 'adverse',
      },
    );
    if (e.hits >= 0) {
      const hits =
        e.hits === 0
          ? []
          : [
              {
                checked: e.adverse,
                side: 'adverse',
                matterId: hitMatter.id,
                matterTitle: hitMatter.title,
                matchedName: hitClient,
                source: 'name',
                existingRole: 'client',
                score: 1,
              },
              {
                checked: e.adverse,
                side: 'adverse',
                matterId: nearMatter.id,
                matterTitle: nearMatter.title,
                matchedName: nearClient,
                source: 'name',
                existingRole: 'client',
                score: 0.82,
              },
            ].slice(0, e.hits);
      rows.conflictResults.push({
        id: did(ID_KIND.conflictResult, k + 1),
        ...stamp,
        enquiryId: eid,
        checkedBy: advocate.id,
        checkedAt: received,
        partyCount: 2,
        hitCount: hits.length,
        hits,
      });
    }
  });

  // List diff: per forum the daily list of today and a later supplementary list that adds, moves,
  // re-stages and drops rows.
  const hallNo = (hallId: string | null | undefined) =>
    (courts.halls as Hall[]).find((h) => h.id === hallId)?.hallNo ?? null;
  const forumIds = courts.forums.map((f) => f.id as string);
  forumIds.forEach((forumId, f) => {
    const todays = graph.listings.filter(
      (l) =>
        l.listDate === today &&
        l.canonical === true &&
        graph.proceedings.find((p) => p.id === l.proceedingId)?.forumId === forumId,
    );
    if (todays.length < 2) return;
    const base = todays.map((l) => ({
      proceedingKey: l.proceedingId,
      hallNo: hallNo(l.hallId),
      itemNo: l.itemNo ?? null,
      stage: l.stageRaw,
    }));
    const next = base.map((r) => ({ ...r }));
    next.shift();
    const moved = next[0];
    if (moved) moved.itemNo = String(Number(/\d+/.exec(moved.itemNo ?? '1')?.[0] ?? 1) + 7);
    const restaged = next[1];
    if (restaged) restaged.stage = 'FOR ORDERS (SUPPLEMENTARY)';
    const added = graph.listings.find(
      (l) =>
        l.listDate !== today &&
        l.canonical === true &&
        !base.some((b) => b.proceedingKey === l.proceedingId) &&
        graph.proceedings.find((p) => p.id === l.proceedingId)?.forumId === forumId,
    );
    if (added)
      next.push({
        proceedingKey: added.proceedingId,
        hallNo: base[0]?.hallNo ?? null,
        itemNo: '88',
        stage: 'FOR ADMISSION',
      });
    const hash = (r: typeof base) =>
      sha(
        JSON.stringify(
          [...r]
            .sort((a, b) => a.proceedingKey.localeCompare(b.proceedingKey))
            .map((x) => [x.proceedingKey, x.hallNo, x.itemNo, x.stage]),
        ),
      );
    rows.snapshots.push(
      {
        id: did(ID_KIND.snapshot, f * 2 + 1),
        ...stamp,
        createdAt: new Date(at.getTime() - 3_600_000),
        forumId,
        listDate: today,
        listType: 'daily',
        contentHash: hash(base),
        rows: base,
      },
      {
        id: did(ID_KIND.snapshot, f * 2 + 2),
        ...stamp,
        forumId,
        listDate: today,
        listType: 'supplementary',
        contentHash: hash(next),
        rows: next,
      },
    );
  });

  // Court-day marker: the board is at item 9 in the first hall with a listing today.
  const firstToday = graph.listings.find((l) => l.listDate === today && l.canonical === true);
  if (firstToday?.hallId) {
    rows.markers.push({
      id: did(ID_KIND.marker, 1),
      workspaceId: ws.id,
      hallId: firstToday.hallId,
      listDate: today,
      currentItem: 9,
      setBy: advocate.id,
      setAt: at,
      note: 'Court has risen for lunch after item 9.',
    });
  }
  // Brief state for the listings of today: prepared, with a note and a carry list.
  graph.listings
    .filter((l) => l.listDate === today && l.canonical === true)
    .slice(0, 6)
    .forEach((l, k) => {
      rows.briefStates.push({
        id: did(ID_KIND.briefState, k + 1),
        ...stamp,
        listingId: l.id as string,
        preparedBy: junior.id,
        preparedAt: at,
        updatedBy: advocate.id,
        note: 'Compilation is in the blue file; counter affidavit at tab 4.',
        carry: [
          {
            key: `manual:demo-${String(k + 1)}-a`,
            manual: true,
            removed: false,
            label: 'Vakalat and certified copy of the last order',
            ticked: k % 2 === 0,
          },
          {
            key: `manual:demo-${String(k + 1)}-b`,
            manual: true,
            removed: false,
            label: 'Memo of citations (three copies)',
            ticked: false,
          },
        ],
      });
    });

  // Unreconciled directions: an order with three directions, one an obligation, one marked not
  // applicable with its reason and one left unresolved.
  const um = matterAt(0);
  const up = mainOf(um.id as string);
  if (up) {
    const docId = did(ID_KIND.document, 9000);
    const anchors = [9001, 9002, 9003].map((n) => did(ID_KIND.anchor, n));
    const dirs = [
      'The respondents shall file a counter affidavit within two weeks.',
      'The petitioner shall serve a copy of the paper-book on the standing counsel.',
      'The respondents shall produce the original licence file before the next date of hearing.',
    ];
    const caseNo = `${up.caseTypeCode}-DEMO/2026/UNRECONCILED`;
    const input: DemoPdfInput = {
      caseNumber: caseNo,
      title: `Interim order dated ${yesterday}`,
      lines: ['Three operative directions follow.', ...dirs],
    };
    rows.pdfs.push({ documentId: docId, input });
    rows.documents.push({
      id: docId,
      ...stamp,
      kind: 'order',
      language: 'en',
      storageKey: `ws/${ws.id}/document/${String(at.getUTCFullYear())}/${docId}`,
      sha256: demoOrderPdf(input).sha256,
      textStatus: 'skipped',
      matterId: um.id,
    });
    anchors.forEach((a, k) =>
      rows.anchors.push({
        id: a,
        ...stamp,
        documentId: docId,
        pageNo: 1 + (k > 0 ? 1 : 0),
        quote: dirs[k] as string,
        kind: 'document',
      }),
    );
    const orderId = did(ID_KIND.order, 9000);
    const directions: OperativeDirection[] = dirs.map((text, k) => ({
      text,
      anchorId: anchors[k] as string,
    }));
    rows.orders.push({
      id: orderId,
      ...fact,
      anchorId: anchors[0],
      proceedingId: up.id as string,
      documentId: docId,
      orderDate: yesterday,
      benchId: graph.orders[0]?.benchId ?? null,
      orderType: 'interim',
      operativeDirections: directions,
      nextDate: addDays(today, 6),
    });
    const base = {
      ...fact,
      matterId: um.id as string,
      proceedingId: up.id as string,
      ownerMemberId: advocate.memberId,
      sourceOrderId: orderId,
      source: 'order_direction' as const,
    };
    rows.obligations.push(
      {
        id: did(ID_KIND.obligation, 9001),
        ...base,
        anchorId: anchors[0],
        description: dirs[0] as string,
        dueDate: addDays(today, 5),
        basis: `Order dated ${yesterday}`,
      },
      {
        id: did(ID_KIND.obligation, 9002),
        ...base,
        anchorId: anchors[1],
        description: dirs[1] as string,
        status: 'not_applicable',
        closedReasonType: 'not_applicable',
        closedBy: advocate.memberId,
        closedAt: at,
        closedNote: 'Already served at the last hearing; standing counsel acknowledged.',
      },
    );
  }

  // Junior handover (chambers only): the junior's matters pass notes to and from the advocate.
  if (ws.members.includes('junior')) {
    const ownedByJunior = graph.matters
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.ownerMemberId === junior.memberId);
    ownedByJunior.slice(0, 3).forEach(({ m, i }, k) => {
      const p = mainOf(m.id as string);
      const line = (text: string, label: string | null = null) => ({
        text,
        label,
        page_no: null,
        quote: null,
        source_type: 'manual',
        source_ref: null,
        anchor_id: null,
        confidence: null,
        confirmation_state: 'confirmed',
      });
      const open = graph.obligations.find(
        (o) => o.matterId === m.id && o.status === undefined && o.dueDate,
      );
      rows.handovers.push({
        id: did(ID_KIND.handover, k + 1),
        workspaceId: ws.id,
        matterId: m.id as string,
        authorId: advocate.memberId,
        recipientId: junior.memberId,
        version: 1,
        acknowledgedAt: k === 0 ? at : null,
        createdAt: new Date(at.getTime() - (k + 1) * 86_400_000),
        body: {
          derived: {
            matter_id: m.id,
            generated_at: at.toISOString(),
            synopsis: line(`${m.title}: handed over to the junior for the next date.`),
            stages: p
              ? [
                  {
                    proceeding_id: p.id,
                    line: line(`Stage: ${p.titlePetitioner ?? ''} (synthetic demo handover)`),
                  },
                ]
              : [],
            last_orders: [],
            open_obligations: open
              ? [
                  {
                    obligation_id: open.id,
                    text: open.description,
                    owner_member_id: junior.memberId,
                    due_date: open.dueDate ?? null,
                    status: 'open',
                    overdue: false,
                    source_type: 'manual',
                    source_ref: null,
                    anchor_id: null,
                    confidence: null,
                    confirmation_state: 'confirmed',
                  },
                ]
              : [],
            coming_up: [],
            key_documents: [],
            open_questions: [line('Does the client accept the adjournment on costs?')],
            open_questions_label: null,
          },
          edits: {
            where_it_stands:
              'Pleadings are complete; the matter is at the stage shown. Watch the next date.',
          },
        },
      });
      rows.matterViews.push({
        id: did(ID_KIND.matterView, i + 1),
        workspaceId: ws.id,
        matterId: m.id as string,
        memberId: junior.memberId,
        viewedAt: new Date(at.getTime() - 6 * 86_400_000),
      });
    });
  }
  // Delegated appearances: hearings of the last days, assigned to the junior with a note; plus
  // proof-of-value ratings on them.
  const delegateTo = ws.members.includes('junior') ? junior : demoMember(ws, 'clerk');
  graph.hearings.slice(0, 40).forEach((h, k) => {
    if (k % 4 !== 0) return;
    const aid = did(ID_KIND.appearance, k / 4 + 1);
    rows.appearances.push({
      id: aid,
      ...stamp,
      hearingId: h.id as string,
      memberId: delegateTo.memberId,
      capacity: 'assisting',
      assignedByMemberId: advocate.memberId,
      note: 'Please mention the matter and take the next date; carry the vakalat.',
    });
    if (ws.members.includes('junior') && k % 8 === 0) {
      rows.ratings.push({
        id: did(ID_KIND.rating, k / 8 + 1),
        ...stamp,
        appearanceId: aid,
        memberId: advocate.memberId,
        rating: 3 + ((k / 8) % 3),
        baseline: false,
      });
    }
  });
  rows.pulses.push(
    {
      id: did(ID_KIND.pulse, 1),
      ...stamp,
      memberId: advocate.memberId,
      isoWeek: '2026-W42',
      demand: 4,
      worry: 2,
      effort: 3,
      baseline: true,
    },
    {
      id: did(ID_KIND.pulse, 2),
      ...stamp,
      memberId: advocate.memberId,
      isoWeek: '2026-W43',
      demand: 3,
      worry: 3,
      effort: 4,
      baseline: false,
    },
  );

  // Fees and the client ledger: an agreement on twelve matters, invoices in each state, payments.
  const gstin = ws.key === 'chennai-solo' ? '33ABCDE1234F1Z5' : '29ABCDE1234F1Z5';
  const state = ws.key === 'chennai-solo' ? '33' : '29';
  activeIdx.slice(0, 12).forEach((mi, k) => {
    const m = matterAt(mi);
    const c = clientOf(mi);
    if (c === undefined) return;
    const aid = did(ID_KIND.feeAgreement, k + 1);
    const basis = (['fixed', 'per_appearance', 'retainer', 'hourly'] as const)[k % 4] ?? 'fixed';
    rows.agreements.push({
      id: aid,
      ...stamp,
      matterId: m.id as string,
      personId: c.id as string,
      basis,
      amountPaise: ((25 + k * 5) * 100_000) / 10,
      gstTreatment: 'forward_charge',
      status: k < 10 ? 'active' : 'draft',
      startsOn: addDays(today, -90 + k),
      notes: 'Synthetic fee terms for the demo.',
      createdBy: advocate.id,
    });
    rows.ledger.push({
      id: did(ID_KIND.ledger, k * 3 + 1),
      workspaceId: ws.id,
      personId: c.id as string,
      matterId: m.id,
      kind: 'receipt',
      direction: 'credit',
      amountPaise: 1_000_000,
      description: 'Advance received (synthetic)',
      occurredOn: addDays(today, -60 + k),
      createdBy: advocate.id,
      createdAt: at,
    });
    rows.ledger.push({
      id: did(ID_KIND.ledger, k * 3 + 2),
      workspaceId: ws.id,
      personId: c.id as string,
      matterId: m.id,
      kind: 'disbursement',
      direction: 'debit',
      amountPaise: 35_000,
      description: 'Court fee and copying charges (synthetic)',
      occurredOn: addDays(today, -30 + k),
      createdBy: advocate.id,
      createdAt: at,
    });
    if (k >= 9) return;
    const status = (
      ['draft', 'issued', 'issued', 'paid', 'paid', 'void', 'issued', 'paid', 'draft'] as const
    )[k] as 'draft' | 'issued' | 'paid' | 'void';
    const taxable = (30 + k * 10) * 10_000;
    const tax = Math.round(taxable * 0.18);
    const iid = did(ID_KIND.invoice, k + 1);
    rows.invoices.push({
      id: iid,
      ...stamp,
      matterId: m.id as string,
      personId: c.id as string,
      feeAgreementId: aid,
      number: status === 'draft' ? null : `DEMO/26-27/${String(k + 1).padStart(4, '0')}`,
      status,
      issueDate: status === 'draft' ? null : addDays(today, -40 + k * 3),
      dueDate: status === 'draft' ? null : addDays(today, -10 + k * 3),
      placeOfSupplyStateCode: state,
      recipientGstin: k % 3 === 0 ? gstin : null,
      taxablePaise: taxable,
      taxPaise: tax,
      totalPaise: taxable + tax,
      createdBy: advocate.id,
    });
    rows.invoiceLines.push({
      id: did(ID_KIND.invoiceLine, k + 1),
      workspaceId: ws.id,
      invoiceId: iid,
      position: 1,
      description: 'Professional fee for appearance and drafting (synthetic)',
      quantity: 1,
      unitPricePaise: taxable,
      amountPaise: taxable,
      gstTreatment: 'forward_charge',
      sac: '998212',
      createdAt: at,
    });
    if (status === 'paid') {
      rows.payments.push({
        id: did(ID_KIND.payment, k + 1),
        workspaceId: ws.id,
        invoiceId: iid,
        amountPaise: taxable + tax,
        method: 'upi',
        reference: `DEMO-UPI-${String(k + 1).padStart(4, '0')}`,
        receivedOn: addDays(today, -5 - k),
        createdBy: advocate.id,
        createdAt: at,
      });
    }
  });

  // Limitation: three counsel-style rules (demo table) and computations on three matters.
  const rules = [
    {
      code: 'demo.suit.recovery',
      title: 'Suit for money recovery (demo rule)',
      statute: 'Limitation Act, 1963 (demo table)',
      value: 3,
      unit: 'years',
      event: 'cause_of_action',
    },
    {
      code: 'demo.appeal.hc',
      title: 'Appeal to the High Court (demo rule)',
      statute: 'Limitation Act, 1963 (demo table)',
      value: 90,
      unit: 'days',
      event: 'order_date',
    },
    {
      code: 'demo.arb.setaside',
      title: 'Application to set aside an award (demo rule)',
      statute: 'Arbitration Act (demo table)',
      value: 3,
      unit: 'months',
      event: 'order_date',
    },
  ] as const;
  rules.forEach((r, k) => {
    rows.limitationRules.push({
      id: did(ID_KIND.limRule, k + 1),
      workspaceId: ws.id,
      code: r.code,
      title: r.title,
      statute: r.statute,
      periodValue: r.value,
      periodUnit: r.unit,
      startEvent: r.event,
      condonable: k !== 2,
      citation: 'SYNTHETIC demo rule: not legal advice',
      reviewed: true,
      reviewedAt: at,
      tableVersion: 'demo-1',
      createdAt: at,
      updatedAt: at,
    });
  });
  activeIdx.slice(0, 3).forEach((mi, k) => {
    const r = rules[k] as (typeof rules)[number];
    const start = addDays(today, -(k === 0 ? 400 : k === 1 ? 60 : 70));
    const exp =
      r.unit === 'years'
        ? addDays(start, 365 * r.value)
        : r.unit === 'days'
          ? addDays(start, r.value)
          : addDays(start, 30 * r.value + 1);
    rows.limitationComputations.push({
      id: did(ID_KIND.limComp, k + 1),
      ...stamp,
      matterId: matterAt(mi).id as string,
      ruleId: did(ID_KIND.limRule, k + 1),
      input: { matterId: matterAt(mi).id, ruleCode: r.code, startDate: start, excludedDays: 0 },
      result: {
        ruleCode: r.code,
        startDate: start,
        expiresOn: exp,
        status: k === 2 ? 'proposed' : 'confirmed',
        notes: ['SYNTHETIC demo computation'],
      },
      startDate: start,
      expiresOn: exp,
      status: k === 2 ? 'proposed' : 'confirmed',
      createdBy: advocate.id,
    });
  });

  // Client status link on the first matter with a contact (the token is DEMO_STATUS_LINK_TOKEN).
  const sm = matterAt(0);
  rows.statusLinks.push({
    id: did(ID_KIND.statusLink, 1),
    ...stamp,
    matterId: sm.id as string,
    clientContactId: did(ID_KIND.clientContact, 1),
    tokenHash: sha(`${DEMO_STATUS_LINK_TOKEN}:${ws.key}`),
    payload: {
      headline: 'Your matter is listed this week',
      note: 'The next hearing is for admission. No action is needed from you. (Synthetic demo link.)',
      nextDate: addDays(today, 6),
    },
    language: 'en',
    expiresAt: new Date(at.getTime() + 7 * 86_400_000),
    createdBy: advocate.id,
  });

  // Outward drafts (hearing updates for clients and counsel).
  graph.hearings.slice(0, 3).forEach((h, k) => {
    const listing = graph.listings.find((l) => l.id === h.listingId);
    const p = graph.proceedings.find((x) => x.id === listing?.proceedingId);
    const mi = graph.matters.findIndex((m) => m.id === p?.matterId);
    const c = clientOf(Math.max(mi, 0));
    const did0 = did(ID_KIND.outward, k + 1);
    const isClient = k !== 2;
    rows.outwardDrafts.push({
      id: did0,
      ...stamp,
      matterId: (p?.matterId ?? matterAt(0).id) as string,
      hearingId: h.id,
      audience: isClient ? 'client' : 'senior_counsel',
      language: 'en',
      tone: 'formal',
      status: k === 1 ? 'edited' : 'drafted',
      clientPersonId: isClient ? (c?.id ?? null) : null,
      templateOnly: true,
      createdBy: advocate.id,
    });
    rows.outwardVersions.push({
      id: did(ID_KIND.outwardVersion, k + 1),
      workspaceId: ws.id,
      draftId: did0,
      author: 'system',
      body: `Hearing update (synthetic demo): the matter was taken up on ${h.heldOn}. ${h.outcome ?? ''} The next date is as listed in the court record.`,
      facts: [],
      createdAt: at,
    });
  });

  // Drafting studio: a workspace template and drafts on three matters.
  const tid = did(ID_KIND.template, 1);
  rows.templates.push({
    id: tid,
    workspaceId: ws.id,
    code: 'demo.notice.legal',
    name: 'Legal notice (demo template)',
    kind: 'notice',
    courtPreset: ws.key === 'chennai-solo' ? 'madras_hc' : 'karnataka_hc',
    blocks: [
      { type: 'heading', id: 'h1', level: 1, text: 'SYNTHETIC - DEMO DATA - FICTIONAL' },
      { type: 'slot', id: 's1', resolver: 'matter.title', label: 'Matter' },
      {
        type: 'paragraph',
        id: 'p1',
        text: 'Under instructions from our client, we call upon you to remedy the default within fifteen days.',
      },
    ],
    locale: 'en',
    version: 1,
    enabled: true,
    reviewedBy: null,
    createdAt: at,
    updatedAt: at,
  });
  activeIdx.slice(0, 3).forEach((mi, k) => {
    const m = matterAt(mi);
    const content = [
      { type: 'heading', id: 'h1', level: 1, text: 'SYNTHETIC - DEMO DATA - FICTIONAL' },
      {
        type: 'paragraph',
        id: 'p1',
        text: `Draft notice in ${m.title}. Lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
      },
    ];
    const dv = did(ID_KIND.draftVersion, k + 1);
    rows.drafts.push({
      id: did(ID_KIND.draft, k + 1),
      ...stamp,
      templateId: tid,
      matterId: m.id,
      title: `Notice draft ${String(k + 1)} (demo)`,
      status: k === 2 ? 'final' : 'draft',
      createdBy: advocate.id,
    });
    rows.draftVersions.push({
      id: dv,
      workspaceId: ws.id,
      draftId: did(ID_KIND.draft, k + 1),
      versionNo: 1,
      content,
      contentSha256: sha(JSON.stringify(content)),
      createdBy: advocate.id,
      createdAt: at,
    });
  });

  // Capture inbox: forwarded and uploaded items in each state, with draft proposals to review.
  const channels = ['share', 'upload', 'email', 'camera', 'voice', 'upload'] as const;
  const statuses = [
    'needs_you',
    'needs_you',
    'ready',
    'applied',
    'processing',
    'received',
  ] as const;
  channels.forEach((channel, k) => {
    const cid = did(ID_KIND.capture, k + 1);
    rows.captures.push({
      id: cid,
      workspaceId: ws.id,
      channel,
      status: statuses[k],
      mime: channel === 'voice' ? 'audio/mp4' : 'application/pdf',
      sizeBytes: 48_000 + k * 1_000,
      originalFilename: `demo-${channel}-${String(k + 1)}.${channel === 'voice' ? 'm4a' : 'pdf'}`,
      sourceMeta: { synthetic: true },
      matterHintId: matterAt(k).id,
      aiBlocked: true,
      scanStatus: 'skipped',
      createdBy: advocate.id,
      createdAt: new Date(at.getTime() - k * 3_600_000),
    });
    if (k < 3) {
      rows.proposals.push({
        id: did(ID_KIND.proposal, k + 1),
        workspaceId: ws.id,
        captureId: cid,
        kind: 'next_date',
        level: 'L2',
        status: 'proposed',
        payload: {
          matterId: matterAt(k).id,
          nextDate: addDays(today, 14 + k),
          summary: 'Next date read from the forwarded order (synthetic).',
        },
        anchors: [],
        confidence: '0.640',
        matterId: matterAt(k).id,
        idempotencyKey: sha(`demo:${ws.key}:proposal:${String(k)}`),
        needsYou: k < 2,
        needsYouReason: k < 2 ? 'Confirm the date against the order' : null,
        createdAt: at,
      });
    }
  });

  // In-app notifications (the bell): the demo never sends email, push or WhatsApp.
  [
    [
      'reminder',
      'Hearing tomorrow',
      'You have matters listed tomorrow. Open the brief sheets.',
      'tomorrow',
    ],
    [
      'obligation',
      'Counter affidavit overdue',
      'An order direction is overdue by two days.',
      'obligations',
    ],
    ['court_day', 'The list changed', 'A supplementary list moved two of your items.', 'today'],
  ].forEach(([category, title, body, href], k) => {
    rows.notifications.push({
      id: did(ID_KIND.notification, k + 1),
      workspaceId: ws.id,
      userId: advocate.id,
      category: category as string,
      title: title as string,
      body: body,
      href: `/w/${ws.slug}/${href as string}`,
      data: {},
      dedupeKey: `demo:${String(k + 1)}`,
      createdAt: new Date(at.getTime() - k * 1_800_000),
    });
  });

  // Issue tags and research notes on the first matters.
  activeIdx.slice(0, 4).forEach((mi, k) => {
    rows.issueTags.push({
      id: did(ID_KIND.issueTag, k + 1),
      ...stamp,
      matterId: matterAt(mi).id as string,
      statute: 'Demo Statute (fictional), 2020',
      section: String(10 + k),
      issue: 'Maintainability and limitation (synthetic tag)',
      status: k === 0 ? 'proposed' : 'confirmed',
      source: k === 0 ? 'ai' : 'manual',
      confidence: k === 0 ? '0.700' : null,
    });
    if (k < 2) {
      rows.researchNotes.push({
        id: did(ID_KIND.researchNote, k + 1),
        ...stamp,
        matterId: matterAt(mi).id as string,
        title: 'Points for the next hearing (demo)',
        body: 'Lorem ipsum research note. SYNTHETIC - not legal authority.',
        authorities: [],
        createdBy: advocate.id,
      });
    }
  });

  // Registry defects, certified copies and their audit trail, from the obligations of the graph.
  let ev = 0;
  graph.obligations
    .filter((o) => o.source === 'registry_defect' || o.source === 'certified_copy')
    .slice(0, 24)
    .forEach((o, k) => {
      const oid = o.id as string;
      const pid = o.proceedingId as string;
      if (o.source === 'registry_defect') {
        rows.defects.push({
          id: did(ID_KIND.defect, k + 1),
          ...fact,
          obligationId: oid,
          proceedingId: pid,
          raisedOn: addDays(today, -6),
          cureBy: addDays(today, (k % 5) - 1),
          description: 'Registry objection: the affidavit is not notarised (synthetic).',
          ...(k % 5 === 4 ? { curedOn: yesterday } : {}),
        });
        rows.obligationEvents.push({
          id: did(ID_KIND.obligationEvent, ++ev),
          workspaceId: ws.id,
          obligationId: oid,
          kind: 'defect_raised',
          toValue: 'raised',
          actorMemberId: advocate.memberId,
          at,
        });
      } else {
        const stage = k % 3;
        rows.certifiedCopies.push({
          id: did(ID_KIND.certifiedCopy, k + 1),
          ...fact,
          obligationId: oid,
          proceedingId: pid,
          appliedOn: addDays(today, -8),
          status: (['applied', 'ready', 'collected'] as const)[stage],
          ...(stage >= 1 ? { readyOn: addDays(today, -3) } : {}),
          ...(stage === 2 ? { collectedOn: yesterday } : {}),
        });
        rows.obligationEvents.push({
          id: did(ID_KIND.obligationEvent, ++ev),
          workspaceId: ws.id,
          obligationId: oid,
          kind: 'copy_applied',
          toValue: 'applied',
          actorMemberId: advocate.memberId,
          at,
        });
      }
    });

  // A recovery portfolio over six proceedings.
  rows.portfolios.push({
    id: did(ID_KIND.portfolio, 1),
    ...stamp,
    name: 'Recovery panel (demo, fictional)',
    createdBy: advocate.id,
  });
  graph.proceedings
    .filter((p) => p.kind === 'main' && p.number)
    .slice(0, 6)
    .forEach((p, k) => {
      rows.portfolioCases.push({
        id: did(ID_KIND.portfolioCase, k + 1),
        ...stamp,
        portfolioId: did(ID_KIND.portfolio, 1),
        proceedingId: p.id,
        status: k % 2 === 0 ? 'Pending' : 'Listed',
        nextDate: addDays(today, 3 + k * 4),
      });
    });
  return rows;
}
