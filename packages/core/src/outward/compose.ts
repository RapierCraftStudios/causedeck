// Compose an outward update draft (#735, ADR 0039). The facts come from the matter graph, each
// with its provenance: only confirmed facts read as plain statements, the rest become a flagged
// "to be confirmed" line. The lines are built from the language's templates; the model (task
// `outward_update`, through the gateway: India-only, budgeted, audited) adds an opening and a
// closing only. A sensitive matter, or any gateway failure, gives the template-only draft. The
// draft is written for the lawyer to edit and share; nothing here sends it.
import type { AiGateway } from '@causedeck/ai';
import { schema, type Transaction } from '@causedeck/db';
import {
  DraftRequest,
  type Audience,
  type Language,
  type Tone,
} from '@causedeck/validators/outward-draft';
import { and, asc, eq } from 'drizzle-orm';

import { createCoreAiGateway } from '../ai/index.ts';
import { invalid, notFound } from '../shared/errors.ts';

import {
  audit,
  inOutwardScope,
  parseOutwardInput,
  requireMatterFor,
  type OutwardActor,
  type OutwardDeps,
  type OutwardScope,
} from './context.ts';
import { guardOutward } from './guard.ts';
import { en, type FactTemplate } from './templates/en.ts';
import { kn } from './templates/kn.ts';
import { ta } from './templates/ta.ts';

const {
  hearing,
  listing,
  obligation,
  order,
  outwardDraft,
  outwardDraftVersion,
  person,
  proceeding,
} = schema;

type OutwardFact = schema.OutwardFact;

const TEMPLATES: Readonly<Record<Language, FactTemplate>> = { en, ta, kn };

/** Open obligations a court or client set; the lawyer's own tasks are never reported outward. */
const REPORTED_SOURCES = ['order_direction', 'client'] as const;
const MAX_OBLIGATIONS = 5;

const isConfirmedState = (state: string): boolean =>
  state === 'confirmed' || state === 'auto_applied' || state === 'corrected';

interface Provenanced {
  sourceType: string;
  sourceRef: string | null;
  anchorId: string | null;
  confirmationState: string;
}

const provenanceOf = (
  table: OutwardFact['provenance']['table'],
  recordId: string,
  row: Provenanced,
): OutwardFact['provenance'] => ({
  table,
  recordId,
  sourceType: row.sourceType,
  sourceRef: row.sourceRef,
  anchorId: row.anchorId,
  confirmationState: row.confirmationState,
});

export interface ComposedDraft {
  draftId: string;
  versionId: string;
  body: string;
  facts: OutwardFact[];
  /** True when no model call was made. */
  templateOnly: boolean;
}

async function loadFacts(
  scope: OutwardScope,
  matterId: string,
  source: { hearingId?: string | undefined; orderId?: string | undefined },
  t: FactTemplate,
): Promise<OutwardFact[]> {
  const { tx } = scope;
  const workspaceId = scope.actor.workspaceId;
  const facts: OutwardFact[] = [];
  if (source.hearingId !== undefined) {
    const [row] = await tx
      .select({ hearing })
      .from(hearing)
      .innerJoin(
        listing,
        and(eq(listing.workspaceId, hearing.workspaceId), eq(listing.id, hearing.listingId)),
      )
      .innerJoin(
        proceeding,
        and(
          eq(proceeding.workspaceId, listing.workspaceId),
          eq(proceeding.id, listing.proceedingId),
        ),
      )
      .where(
        and(
          eq(hearing.workspaceId, workspaceId),
          eq(hearing.id, source.hearingId),
          eq(proceeding.matterId, matterId),
        ),
      )
      .limit(1);
    if (row === undefined) throw notFound('Hearing not found');
    const h = row.hearing;
    const state = isConfirmedState(h.confirmationState);
    const nextDate = h.nextDateConfirmed ?? h.nextDateProposed;
    if (nextDate !== null) {
      const confirmed = h.nextDateConfirmed !== null;
      facts.push({
        kind: 'next_date',
        text: t.nextDate(nextDate, confirmed),
        confirmed,
        provenance: provenanceOf('hearing', h.id, h),
      });
    }
    if (h.outcome !== null && h.outcome.trim() !== '') {
      facts.push({
        kind: 'outcome',
        text: t.outcome(h.outcome.trim(), state),
        confirmed: state,
        provenance: provenanceOf('hearing', h.id, h),
      });
    }
  }
  if (source.orderId !== undefined) {
    const [row] = await tx
      .select({ order })
      .from(order)
      .innerJoin(
        proceeding,
        and(eq(proceeding.workspaceId, order.workspaceId), eq(proceeding.id, order.proceedingId)),
      )
      .where(
        and(
          eq(order.workspaceId, workspaceId),
          eq(order.id, source.orderId),
          eq(proceeding.matterId, matterId),
        ),
      )
      .limit(1);
    if (row === undefined) throw notFound('Order not found');
    const o = row.order;
    const state = isConfirmedState(o.confirmationState);
    facts.push({
      kind: 'outcome',
      text: t.order(o.orderType, o.orderDate, state),
      confirmed: state,
      provenance: provenanceOf('order', o.id, o),
    });
    if (o.nextDate !== null) {
      facts.push({
        kind: 'next_date',
        text: t.nextDate(o.nextDate, state),
        confirmed: state,
        provenance: provenanceOf('order', o.id, o),
      });
    }
  }
  const open = await tx
    .select()
    .from(obligation)
    .where(
      and(
        eq(obligation.workspaceId, workspaceId),
        eq(obligation.matterId, matterId),
        eq(obligation.status, 'open'),
      ),
    )
    .orderBy(asc(obligation.dueDate), asc(obligation.id));
  for (const ob of open
    .filter((o) => (REPORTED_SOURCES as readonly string[]).includes(o.source))
    .slice(0, MAX_OBLIGATIONS)) {
    const state = isConfirmedState(ob.confirmationState);
    facts.push({
      kind: 'obligation',
      text: t.obligation(ob.description, ob.dueDate, state),
      confirmed: state,
      provenance: provenanceOf('obligation', ob.id, ob),
    });
  }
  return facts;
}

/** The model's opening and closing, kept only when the guard removes nothing from them. */
async function modelFrame(
  scope: OutwardScope,
  deps: OutwardDeps,
  request: { audience: Audience; language: Language; tone: Tone },
  matterId: string,
  facts: OutwardFact[],
): Promise<{ opening?: string; closing?: string } | null> {
  const gateway: AiGateway = deps.gateway ?? createCoreAiGateway(scope.tx);
  try {
    const result = await gateway.run<{ blocks: { kind: 'opening' | 'closing'; text: string }[] }>(
      'outward_update',
      {
        ...request,
        facts: facts.map((f) => ({ kind: f.kind, text: f.text, confirmed: f.confirmed })),
      },
      {
        workspaceId: scope.actor.workspaceId,
        matterId,
        userId: scope.actor.userId,
        purpose: 'outward.update',
      },
    );
    const frame: { opening?: string; closing?: string } = {};
    for (const block of result.output.blocks) {
      const guarded = guardOutward(block.text, request.language);
      if (guarded.ok && guarded.text !== '') frame[block.kind] ??= guarded.text;
    }
    return frame;
  } catch {
    // Residency, budget, provider or output failures all give the template-only draft.
    return null;
  }
}

async function requireClient(tx: Transaction, workspaceId: string, personId: string) {
  const [row] = await tx
    .select({ kind: person.kind })
    .from(person)
    .where(and(eq(person.workspaceId, workspaceId), eq(person.id, personId)))
    .limit(1);
  if (row === undefined || row.kind !== 'client') {
    throw invalid('clientPersonId: not a client contact of this workspace');
  }
}

export async function composeUpdate(
  deps: OutwardDeps,
  actor: OutwardActor,
  input: unknown,
): Promise<ComposedDraft> {
  const request = parseOutwardInput(DraftRequest, input);
  const language = request.language ?? 'en';
  const tone = request.tone ?? 'formal';
  return inOutwardScope(deps, actor, async (scope) => {
    const workspaceId = scope.actor.workspaceId;
    const row: typeof schema.matter.$inferSelect = await requireMatterFor(
      scope,
      request.matterId,
      'draft.write',
    );
    if (request.clientPersonId !== undefined) {
      await requireClient(scope.tx, workspaceId, request.clientPersonId);
    }
    const template = TEMPLATES[language];
    const facts = await loadFacts(scope, request.matterId, request, template);
    if (facts.length === 0) throw invalid('There is nothing to report from this source yet');

    const frame = row.sensitive
      ? null
      : await modelFrame(
          scope,
          deps,
          { audience: request.audience, language, tone },
          request.matterId,
          facts,
        );
    const opening = frame?.opening ?? template.opening(request.audience, tone);
    const closing = frame?.closing ?? template.closing(request.audience, tone);
    const body = [opening, facts.map((f) => f.text).join('\n'), closing]
      .filter((part) => part !== '')
      .join('\n\n');
    const templateOnly = frame === null;

    const [draft] = await scope.tx
      .insert(outwardDraft)
      .values({
        workspaceId,
        matterId: request.matterId,
        hearingId: request.hearingId ?? null,
        orderId: request.orderId ?? null,
        audience: request.audience,
        language,
        tone,
        clientPersonId: request.clientPersonId ?? null,
        templateOnly,
        createdBy: scope.memberId,
        createdAt: scope.now,
        updatedAt: scope.now,
      })
      .returning({ id: outwardDraft.id });
    if (draft === undefined) throw notFound('Draft not found');
    const [version] = await scope.tx
      .insert(outwardDraftVersion)
      .values({
        workspaceId,
        draftId: draft.id,
        author: 'system',
        body,
        facts,
        createdAt: scope.now,
      })
      .returning({ id: outwardDraftVersion.id });
    if (version === undefined) throw notFound('Draft not found');
    await audit(
      scope,
      'outward.prepared',
      { kind: 'outward_draft', id: draft.id },
      { audience: request.audience, language, templateOnly, facts: facts.length },
    );
    return { draftId: draft.id, versionId: version.id, body, facts, templateOnly };
  });
}
