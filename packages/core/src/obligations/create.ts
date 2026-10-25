// `createObligation` (#67): the one writer of new obligations. The input needs provenance (a
// non-manual fact names its anchor or source), an owner who is an active member, and a due date
// unless it is an undated task (`internal`). A `rule` source is refused: deadlines are never
// computed from a generated legal rule (limitation dates live in #84 behind a flag). Writes the
// `created` event and an `audit_event`.
import { schema, type Transaction } from '@causedeck/db';
import { ObligationInput } from '@causedeck/validators/obligation';
import { and, eq } from 'drizzle-orm';

import { invalid } from '../shared/errors.ts';

import {
  addEvent,
  audit,
  inObligationScope,
  parseInput,
  requireMatterFor,
  requireOwnerMember,
  writeActionFor,
  type ObligationActor,
  type ObligationDeps,
  type ObligationRow,
  type ObligationScope,
} from './context.ts';

const { obligation, proceeding } = schema;

type Parsed = ReturnType<typeof ObligationInput.parse>;

/** The guards and the insert, inside a scope whose actor was already authorised. */
export async function insertObligation(
  scope: ObligationScope,
  data: Parsed,
): Promise<ObligationRow> {
  const { tx, actor } = scope;
  if (data.source === 'rule') {
    throw invalid('source: rule-derived dates are not created here (limitation dates are #84)');
  }
  if (data.dueDate === null && data.source !== 'internal') {
    throw invalid('dueDate: only an undated task may have no due date');
  }
  await requireOwnerMember(tx, actor.workspaceId, data.ownerMemberId);
  if (data.proceedingId != null) {
    const [found] = await tx
      .select({ id: proceeding.id })
      .from(proceeding)
      .where(
        and(
          eq(proceeding.workspaceId, actor.workspaceId),
          eq(proceeding.id, data.proceedingId),
          eq(proceeding.matterId, data.matterId),
        ),
      )
      .limit(1);
    if (found === undefined) throw invalid('proceedingId: not a proceeding of this matter');
  }
  const p = data.provenance;
  const [row] = await tx
    .insert(obligation)
    .values({
      workspaceId: actor.workspaceId,
      matterId: data.matterId,
      proceedingId: data.proceedingId ?? null,
      source: data.source,
      description: data.description,
      dueDate: data.dueDate,
      basis: data.basis ?? null,
      ownerMemberId: data.ownerMemberId,
      sourceOrderId: data.sourceOrderId ?? null,
      status: 'open',
      sourceType: p.sourceType,
      sourceRef: p.sourceRef ?? null,
      anchorId: p.anchorId ?? null,
      confidence: p.confidence ?? null,
      confirmationState:
        p.confirmationState ?? (p.sourceType === 'manual' ? 'confirmed' : 'proposed'),
      ...(p.capturedAt === undefined ? {} : { capturedAt: p.capturedAt }),
    })
    .returning();
  if (row === undefined) throw new Error('createObligation: insert returned no row');
  await addEvent(scope, row.id, { kind: 'created', toValue: data.dueDate });
  await audit(
    scope,
    'obligation.created',
    { kind: 'obligation', id: row.id },
    {
      source: row.source,
      sourceType: row.sourceType,
      dated: row.dueDate !== null,
    },
  );
  return row;
}

export async function createObligation(
  deps: ObligationDeps,
  actor: ObligationActor,
  input: ObligationInput,
): Promise<ObligationRow> {
  const data = parseInput(ObligationInput, input);
  return inObligationScope(deps, actor, async (scope) => {
    await requireMatterFor(scope, data.matterId, writeActionFor(data.source));
    return insertObligation(scope, data);
  });
}

/**
 * Create an obligation from a confirmed proposal (#47): the same guards, inside the engine's own
 * transaction, with the confirmer recorded on the `created` event. The engine already decided
 * that the confirmer may act, so there is no role check here.
 */
export async function createObligationFromProposal(
  tx: Transaction,
  actor: ObligationActor,
  input: Omit<ObligationInput, 'ownerMemberId'> & { ownerMemberId?: string | null },
  now: Date = new Date(),
): Promise<ObligationRow> {
  const { member } = schema;
  const [self] = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, actor.workspaceId), eq(member.userId, actor.userId)))
    .limit(1);
  if (self === undefined) throw invalid('confirmer is not a member of this workspace');
  const data = parseInput(ObligationInput, {
    ...input,
    ownerMemberId: input.ownerMemberId ?? self.id,
  });
  const scope: ObligationScope = {
    tx,
    actor: { ...actor, role: 'owner' },
    memberId: self.id,
    settings: {},
    now,
  };
  return insertObligation(scope, data);
}
