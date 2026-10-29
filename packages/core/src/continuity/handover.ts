// Handover notes (#71): `generateHandover` assembles the derived note for a matter (synopsis, stage
// per proceeding, the last three orders, open obligations, upcoming listings, key documents and open
// questions) and stores nothing; `saveHandover` stores an immutable, numbered version addressed to a
// member; `acknowledgeHandover` lets the recipient mark it read. Every line carries its provenance
// (a line without it is dropped). The synopsis (matter memory) is left out server-side for a role
// without `memory.read`, on generation and again on every read. Strategy notes and court notes are
// never part of a handover. A handover is internal: this file has no share, email or export path.
import { schema } from '@causedeck/db';
import {
  AcknowledgeHandoverInput,
  GenerateHandoverInput,
  HandoverBulkInput,
  HandoverContent,
  HandoverNote,
  ListHandoversInput,
  MAX_HANDOVER_ORDERS,
  MAX_ORDER_LINES,
  NONE_RECORDED,
  SaveHandoverInput,
  type BriefLine,
  type HandoverBody,
  type HandoverListing,
  type HandoverOrder,
  type ObligationLine,
} from '@causedeck/validators';
import { and, asc, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm';

import { conflict, forbidden, invalid, notFound } from '../shared/errors.ts';
import {
  auditContinuity,
  documentLine,
  inContinuityScope,
  continuityIstDay,
  loadMatter,
  mayDoContinuity,
  parseContinuityInput,
  continuityProvenanceOf,
  requireContinuityAction,
  continuityShortDate,
  withContinuityProvenance,
  type ContinuityActor,
  type ContinuityDeps,
  type ContinuityScope,
} from './scope.ts';

const MAX_UPCOMING = 5;
const MAX_KEY_DOCUMENTS = 5;

async function proceedingIds(scope: ContinuityScope, matterId: string): Promise<string[]> {
  const rows = await scope.tx
    .select({ id: schema.proceeding.id })
    .from(schema.proceeding)
    .where(
      and(
        eq(schema.proceeding.workspaceId, scope.actor.workspaceId),
        eq(schema.proceeding.matterId, matterId),
      ),
    );
  return rows.map((r) => r.id);
}

async function stagesOf(scope: ContinuityScope, proceedings: string[]) {
  const stages: HandoverBody['stages'] = [];
  for (const proceedingId of proceedings) {
    const [row] = await scope.tx
      .select()
      .from(schema.listing)
      .where(
        and(
          eq(schema.listing.workspaceId, scope.actor.workspaceId),
          eq(schema.listing.proceedingId, proceedingId),
        ),
      )
      .orderBy(desc(schema.listing.canonical), desc(schema.listing.listDate))
      .limit(1);
    if (row === undefined) continue;
    const [line] = withContinuityProvenance<BriefLine>([
      {
        text: row.stageRaw,
        label: null,
        page_no: null,
        quote: null,
        ...continuityProvenanceOf(row),
      },
    ]);
    if (line !== undefined) stages.push({ proceeding_id: proceedingId, line });
  }
  return stages;
}

async function lastOrdersOf(
  scope: ContinuityScope,
  proceedings: string[],
): Promise<HandoverOrder[]> {
  if (proceedings.length === 0) return [];
  const { tx, actor } = scope;
  const orders = await tx
    .select()
    .from(schema.order)
    .where(
      and(
        eq(schema.order.workspaceId, actor.workspaceId),
        inArray(schema.order.proceedingId, proceedings),
      ),
    )
    .orderBy(desc(schema.order.orderDate), desc(schema.order.createdAt))
    .limit(MAX_HANDOVER_ORDERS);
  const anchorIds = orders.flatMap((o) =>
    o.operativeDirections.slice(0, MAX_ORDER_LINES).map((d) => d.anchorId),
  );
  const anchors =
    anchorIds.length === 0
      ? []
      : await tx
          .select()
          .from(schema.anchor)
          .where(
            and(
              eq(schema.anchor.workspaceId, actor.workspaceId),
              inArray(schema.anchor.id, anchorIds),
            ),
          );
  const byId = new Map(anchors.map((a) => [a.id, a]));
  const result: HandoverOrder[] = [];
  for (const order of orders) {
    const unconfirmed = order.confirmationState === 'proposed';
    const lines: BriefLine[] = [];
    for (const direction of order.operativeDirections.slice(0, MAX_ORDER_LINES)) {
      const anchor = byId.get(direction.anchorId);
      if (anchor === undefined) continue;
      lines.push({
        text: direction.text,
        label: unconfirmed ? 'Unconfirmed' : null,
        page_no: anchor.pageNo,
        quote: anchor.quote,
        ...continuityProvenanceOf({ ...order, anchorId: anchor.id }),
      });
    }
    result.push({
      order_id: order.id,
      order_date: order.orderDate,
      lines: withContinuityProvenance(lines),
    });
  }
  return result;
}

async function obligationsOf(scope: ContinuityScope, matterId: string): Promise<ObligationLine[]> {
  const { tx, actor } = scope;
  const rows = await tx
    .select()
    .from(schema.obligation)
    .where(
      and(
        eq(schema.obligation.workspaceId, actor.workspaceId),
        eq(schema.obligation.matterId, matterId),
        eq(schema.obligation.status, 'open'),
      ),
    );
  const today = continuityIstDay(scope.now);
  const open: ObligationLine[] = rows.map((o) => ({
    obligation_id: o.id,
    text:
      o.dueDate === null
        ? o.description
        : `${o.description}; due ${continuityShortDate(o.dueDate)}`,
    owner_member_id: o.ownerMemberId,
    due_date: o.dueDate,
    status: 'open',
    overdue: o.dueDate !== null && o.dueDate < today,
    ...continuityProvenanceOf(o),
  }));
  return withContinuityProvenance(open).sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) ||
      (a.due_date ?? '9999-12-31').localeCompare(b.due_date ?? '9999-12-31') ||
      a.text.localeCompare(b.text),
  );
}

async function upcomingOf(
  scope: ContinuityScope,
  proceedings: string[],
): Promise<HandoverListing[]> {
  if (proceedings.length === 0) return [];
  const rows = await scope.tx
    .select()
    .from(schema.listing)
    .where(
      and(
        eq(schema.listing.workspaceId, scope.actor.workspaceId),
        inArray(schema.listing.proceedingId, proceedings),
        gte(schema.listing.listDate, continuityIstDay(scope.now)),
      ),
    )
    .orderBy(asc(schema.listing.listDate))
    .limit(MAX_UPCOMING);
  const items: HandoverListing[] = [];
  for (const row of rows) {
    const [line] = withContinuityProvenance<BriefLine>([
      {
        text: `Listed ${continuityShortDate(row.listDate)}: ${row.stageRaw}`,
        label: null,
        page_no: null,
        quote: null,
        ...continuityProvenanceOf(row),
      },
    ]);
    if (line !== undefined) items.push({ listing_id: row.id, list_date: row.listDate, line });
  }
  return items;
}

async function keyDocumentsOf(scope: ContinuityScope, matterId: string): Promise<BriefLine[]> {
  const rows = await scope.tx
    .select()
    .from(schema.document)
    .where(
      and(
        eq(schema.document.workspaceId, scope.actor.workspaceId),
        eq(schema.document.matterId, matterId),
      ),
    )
    .orderBy(desc(schema.document.createdAt))
    .limit(MAX_KEY_DOCUMENTS);
  return rows.map((d) =>
    documentLine(
      d,
      `${d.kind.replaceAll('_', ' ')}, added ${d.createdAt.toISOString().slice(0, 10)}`,
    ),
  );
}

/** The open questions the last saved version carried: lawyer-authored lines, never invented. */
async function carriedQuestions(scope: ContinuityScope, matterId: string): Promise<BriefLine[]> {
  const [row] = await scope.tx
    .select({ body: schema.handoverNote.body })
    .from(schema.handoverNote)
    .where(
      and(
        eq(schema.handoverNote.workspaceId, scope.actor.workspaceId),
        eq(schema.handoverNote.matterId, matterId),
      ),
    )
    .orderBy(desc(schema.handoverNote.version))
    .limit(1);
  const parsed = HandoverContent.safeParse(row?.body);
  return parsed.success ? parsed.data.derived.open_questions : [];
}

function questionLine(text: string): BriefLine {
  return {
    text,
    label: null,
    page_no: null,
    quote: null,
    source_type: 'manual',
    source_ref: null,
    anchor_id: null,
    confidence: null,
    confirmation_state: 'confirmed',
  };
}

async function derive(
  scope: ContinuityScope,
  matterId: string,
  questions: BriefLine[] | null,
): Promise<HandoverBody> {
  const matter = await loadMatter(scope, matterId);
  const proceedings = await proceedingIds(scope, matter.id);
  const memory = scope.deps.memory;
  const synopsis =
    memory !== undefined && (await mayDoContinuity(scope, 'memory.read'))
      ? await memory.synopsis({
          workspaceId: scope.actor.workspaceId,
          matterId,
          userId: scope.actor.userId,
        })
      : null;
  const [synopsisLine] = synopsis === null ? [] : withContinuityProvenance([toLine(synopsis.line)]);
  const open_questions = questions ?? (await carriedQuestions(scope, matterId));
  return {
    matter_id: matterId,
    generated_at: scope.now.toISOString(),
    synopsis: synopsisLine ?? null,
    stages: await stagesOf(scope, proceedings),
    last_orders: await lastOrdersOf(scope, proceedings),
    open_obligations: await obligationsOf(scope, matter.id),
    coming_up: await upcomingOf(scope, proceedings),
    key_documents: await keyDocumentsOf(scope, matter.id),
    open_questions,
    open_questions_label: open_questions.length === 0 ? NONE_RECORDED : null,
  };
}

function toLine(line: {
  text: string;
  label: string | null;
  page_no?: number | null;
  quote?: string | null;
  source_type: BriefLine['source_type'];
  source_ref: string | null;
  anchor_id: string | null;
  confidence: number | null;
  confirmation_state: BriefLine['confirmation_state'];
}): BriefLine {
  return { ...line, page_no: line.page_no ?? null, quote: line.quote ?? null };
}

/** The derived handover of a matter (needs `matter.read`). Writes nothing but an access audit event. */
export async function generateHandover(
  deps: ContinuityDeps,
  actor: ContinuityActor,
  matterId: string,
): Promise<HandoverBody> {
  const input = parseContinuityInput(GenerateHandoverInput, { matterId });
  return inContinuityScope(deps, actor, async (scope) => {
    await requireContinuityAction(scope, 'matter.read', 'You cannot read this matter');
    const body = await derive(scope, input.matterId, null);
    await auditContinuity(scope, 'handover.generated', { kind: 'matter', id: input.matterId });
    return body;
  });
}

type Row = typeof schema.handoverNote.$inferSelect;

/** A stored note as the reader may see it: the synopsis (matter memory) only for `memory.read`. */
async function present(scope: ContinuityScope, row: Row): Promise<HandoverNote> {
  const content = HandoverContent.parse(row.body);
  const derived = (await mayDoContinuity(scope, 'memory.read'))
    ? content.derived
    : { ...content.derived, synopsis: null };
  return HandoverNote.parse({
    id: row.id,
    matter_id: row.matterId,
    version: row.version,
    author_id: row.authorId,
    recipient_id: row.recipientId,
    body: { derived, edits: content.edits },
    acknowledged_at: row.acknowledgedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  });
}

async function insertVersion(
  scope: ContinuityScope,
  input: {
    matterId: string;
    recipientMemberId: string;
    edits: HandoverContent['edits'];
    questions: BriefLine[];
  },
): Promise<HandoverNote> {
  const { tx, actor } = scope;
  const [recipient] = await tx
    .select({ id: schema.member.id, status: schema.member.status })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, actor.workspaceId),
        eq(schema.member.id, input.recipientMemberId),
      ),
    )
    .limit(1);
  if (recipient === undefined || recipient.status !== 'active') {
    throw invalid('The recipient must be an active member of this workspace');
  }
  const derived = await derive(scope, input.matterId, input.questions);
  const [last] = await tx
    .select({ version: schema.handoverNote.version })
    .from(schema.handoverNote)
    .where(
      and(
        eq(schema.handoverNote.workspaceId, actor.workspaceId),
        eq(schema.handoverNote.matterId, input.matterId),
      ),
    )
    .orderBy(desc(schema.handoverNote.version))
    .limit(1);
  const content = HandoverContent.parse({ derived, edits: input.edits });
  let row: Row | undefined;
  try {
    [row] = await tx
      .insert(schema.handoverNote)
      .values({
        workspaceId: actor.workspaceId,
        matterId: input.matterId,
        authorId: scope.memberId,
        recipientId: recipient.id,
        body: content,
        version: (last?.version ?? 0) + 1,
        createdAt: scope.now,
      })
      .returning();
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    if (code !== '23505') throw error;
    throw conflict('Another handover was saved at the same time; try again');
  }
  if (row === undefined) throw conflict('The handover was not saved');
  await auditContinuity(scope, 'handover.saved', { kind: 'handover_note', id: row.id });
  return present(scope, row);
}

/**
 * Save an immutable version addressed to a member (needs `task.write`, so not a viewer). The derived
 * content is regenerated here; only the author's section edits and open questions come from the input.
 */
export async function saveHandover(
  deps: ContinuityDeps,
  actor: ContinuityActor,
  input: unknown,
): Promise<HandoverNote> {
  const parsed = parseContinuityInput(SaveHandoverInput, input);
  return inContinuityScope(deps, actor, async (scope) => {
    await requireContinuityAction(scope, 'matter.read', 'You cannot read this matter');
    await requireContinuityAction(scope, 'task.write', 'You cannot write a handover');
    await loadMatter(scope, parsed.matterId);
    return insertVersion(scope, {
      matterId: parsed.matterId,
      recipientMemberId: parsed.recipientMemberId,
      edits: parsed.edits,
      questions: parsed.openQuestions.map(questionLine),
    });
  });
}

/** The versions of a matter the actor wrote or received, newest first. */
export async function listHandovers(
  deps: ContinuityDeps,
  actor: ContinuityActor,
  input: unknown,
): Promise<HandoverNote[]> {
  const { matterId } = parseContinuityInput(ListHandoversInput, input);
  return inContinuityScope(deps, actor, async (scope) => {
    await requireContinuityAction(scope, 'matter.read', 'You cannot read this matter');
    await loadMatter(scope, matterId);
    const rows = await scope.tx
      .select()
      .from(schema.handoverNote)
      .where(
        and(
          eq(schema.handoverNote.workspaceId, scope.actor.workspaceId),
          eq(schema.handoverNote.matterId, matterId),
          or(
            eq(schema.handoverNote.authorId, scope.memberId),
            eq(schema.handoverNote.recipientId, scope.memberId),
          ),
        ),
      )
      .orderBy(desc(schema.handoverNote.version));
    await auditContinuity(scope, 'handover.read', { kind: 'matter', id: matterId });
    return Promise.all(rows.map((row) => present(scope, row)));
  });
}

/** The recipient marks a note read; repeating it keeps the first time. Anyone else is refused. */
export async function acknowledgeHandover(
  deps: ContinuityDeps,
  actor: ContinuityActor,
  input: unknown,
): Promise<HandoverNote> {
  const { handoverId } = parseContinuityInput(AcknowledgeHandoverInput, input);
  return inContinuityScope(deps, actor, async (scope) => {
    await requireContinuityAction(scope, 'matter.read', 'You cannot read this matter');
    const [row] = await scope.tx
      .select()
      .from(schema.handoverNote)
      .where(
        and(
          eq(schema.handoverNote.workspaceId, scope.actor.workspaceId),
          eq(schema.handoverNote.id, handoverId),
        ),
      )
      .limit(1);
    if (row === undefined) throw notFound('Handover not found');
    if (row.recipientId !== scope.memberId) throw forbidden('Only the recipient can acknowledge');
    if (row.acknowledgedAt !== null) return present(scope, row);
    const [updated] = await scope.tx
      .update(schema.handoverNote)
      .set({ acknowledgedAt: scope.now })
      .where(
        and(
          eq(schema.handoverNote.workspaceId, scope.actor.workspaceId),
          eq(schema.handoverNote.id, handoverId),
          isNull(schema.handoverNote.acknowledgedAt),
        ),
      )
      .returning();
    await auditContinuity(scope, 'handover.acknowledged', {
      kind: 'handover_note',
      id: handoverId,
    });
    return present(scope, updated ?? row);
  });
}

/**
 * The offboarding hook (#18): a handover note, addressed to `toMemberId`, for every active matter
 * `fromMemberId` owns. Called by the leaving flow next to the reassignment; needs `matter.write`.
 */
export async function generateHandoversForMember(
  deps: ContinuityDeps,
  actor: ContinuityActor,
  input: unknown,
): Promise<HandoverNote[]> {
  const { fromMemberId, toMemberId } = parseContinuityInput(HandoverBulkInput, input);
  return inContinuityScope(deps, actor, async (scope) => {
    await requireContinuityAction(scope, 'matter.write', 'You cannot hand over matters');
    const matters = await scope.tx
      .select({ id: schema.matter.id })
      .from(schema.matter)
      .where(
        and(
          eq(schema.matter.workspaceId, scope.actor.workspaceId),
          eq(schema.matter.ownerMemberId, fromMemberId),
          eq(schema.matter.status, 'active'),
        ),
      )
      .orderBy(asc(schema.matter.openedAt));
    const notes: HandoverNote[] = [];
    for (const m of matters) {
      notes.push(
        await insertVersion(scope, {
          matterId: m.id,
          recipientMemberId: toMemberId,
          edits: {},
          questions: await carriedQuestions(scope, m.id),
        }),
      );
    }
    return notes;
  });
}
