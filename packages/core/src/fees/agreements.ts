// Fee agreement services (#83 part 3): create, update, set status, get and list. A human writes the
// row directly; an automation-origin entry is only ever an L2 `fee_entry` proposal that the lawyer
// accepts (money is always a proposal). Audit metadata holds ids and counts, never notes.
import { schema } from '@causedeck/db';
import { FeeAgreementInput } from '@causedeck/validators/fees';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { record } from '../audit/index.ts';
import { submitProposals } from '../automation/index.ts';
import { conflict, notFound } from '../shared/errors.ts';

import {
  parseFeeInput,
  auditCtx,
  withFees,
  type FeesActor,
  type FeesDeps,
  type FeesScope,
} from './scope.ts';

const { feeAgreement, matter, person } = schema;

export type FeeAgreementView = typeof feeAgreement.$inferSelect;

export type FeeAgreementCreated =
  { status: 'created'; agreement: FeeAgreementView } | { status: 'proposed'; proposalId: string };

const NO_EVENTS = {
  emit() {
    // Staging a proposal has no event subscribers.
  },
};

const AgreementId = z.strictObject({ agreementId: z.uuid() });
const UpdateInput = z.strictObject({
  agreementId: z.uuid(),
  basis: FeeAgreementInput.shape.basis.optional(),
  amountPaise: FeeAgreementInput.shape.amountPaise.optional(),
  gstTreatment: FeeAgreementInput.shape.gstTreatment.optional(),
  startsOn: FeeAgreementInput.shape.startsOn.optional(),
  endsOn: FeeAgreementInput.shape.endsOn.nullable().optional(),
  notes: FeeAgreementInput.shape.notes.nullable().optional(),
});
const StatusInput = z.strictObject({
  agreementId: z.uuid(),
  status: z.enum(['active', 'ended']),
});
const ListInput = z.strictObject({ matterId: z.uuid().optional() }).default({});

export async function requireMatterAndPerson(
  scope: FeesScope,
  matterId: string | undefined,
  personId: string,
): Promise<void> {
  const ws = scope.actor.workspaceId;
  if (matterId !== undefined) {
    const [m] = await scope.tx
      .select({ id: matter.id })
      .from(matter)
      .where(and(eq(matter.workspaceId, ws), eq(matter.id, matterId)));
    if (m === undefined) throw notFound('Matter not found');
  }
  const [p] = await scope.tx
    .select({ id: person.id })
    .from(person)
    .where(and(eq(person.workspaceId, ws), eq(person.id, personId)));
  if (p === undefined) throw notFound('Person not found');
}

async function loadAgreement(scope: FeesScope, agreementId: string): Promise<FeeAgreementView> {
  const [row] = await scope.tx
    .select()
    .from(feeAgreement)
    .where(
      and(eq(feeAgreement.workspaceId, scope.actor.workspaceId), eq(feeAgreement.id, agreementId)),
    );
  if (row === undefined) throw notFound('Fee agreement not found');
  return row;
}

export async function createFeeAgreement(
  deps: FeesDeps,
  actor: FeesActor,
  input: unknown,
  origin: 'user' | 'automation' = 'user',
): Promise<FeeAgreementCreated> {
  return withFees(deps, actor, 'fee.write', async (scope) => {
    const data = parseFeeInput(FeeAgreementInput, input);
    await requireMatterAndPerson(scope, data.matterId, data.personId);
    if (origin === 'automation') {
      const { items } = await submitProposals(
        { db: scope.tx, events: NO_EVENTS, now: () => scope.now },
        { workspaceId: actor.workspaceId, userId: actor.userId },
        [
          {
            kind: 'fee_entry',
            source: { type: 'manual', input: 'form', ref: data.matterId },
            payload: { ...data },
            confidence: null,
          },
        ],
      );
      const item = items[0];
      if (item?.proposalId == null) {
        throw conflict(item?.reason ?? 'The fee proposal could not be created');
      }
      return { status: 'proposed' as const, proposalId: item.proposalId };
    }
    const [row] = await scope.tx
      .insert(feeAgreement)
      .values({
        workspaceId: actor.workspaceId,
        matterId: data.matterId,
        personId: data.personId,
        basis: data.basis,
        amountPaise: data.amountPaise,
        gstTreatment: data.gstTreatment,
        startsOn: data.startsOn,
        endsOn: data.endsOn ?? null,
        notes: data.notes ?? null,
        createdBy: actor.userId,
      })
      .returning();
    if (row === undefined) throw new Error('fee_agreement insert returned no row');
    await record(auditCtx(scope), {
      action: 'fee.agreement_created',
      target: { kind: 'fee_agreement', id: row.id },
      metadata: { basis: row.basis },
    });
    return { status: 'created' as const, agreement: row };
  });
}

export async function updateFeeAgreement(
  deps: FeesDeps,
  actor: FeesActor,
  input: unknown,
): Promise<FeeAgreementView> {
  return withFees(deps, actor, 'fee.write', async (scope) => {
    const { agreementId, ...changes } = parseFeeInput(UpdateInput, input);
    const current = await loadAgreement(scope, agreementId);
    if (current.status === 'ended') throw conflict('An ended fee agreement cannot be changed');
    const set: Partial<typeof feeAgreement.$inferInsert> = { updatedAt: scope.now };
    const fields: string[] = [];
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) continue;
      (set as Record<string, unknown>)[key] = value;
      fields.push(key);
    }
    const startsOn = set.startsOn ?? current.startsOn;
    const endsOn = 'endsOn' in set ? set.endsOn : current.endsOn;
    if (endsOn != null && endsOn < startsOn) {
      throw conflict('The end date cannot be before the start date');
    }
    const [row] = await scope.tx
      .update(feeAgreement)
      .set(set)
      .where(and(eq(feeAgreement.workspaceId, actor.workspaceId), eq(feeAgreement.id, agreementId)))
      .returning();
    if (row === undefined) throw notFound('Fee agreement not found');
    await record(auditCtx(scope), {
      action: 'fee.agreement_updated',
      target: { kind: 'fee_agreement', id: row.id },
      metadata: { fields: fields.join(',') },
    });
    return row;
  });
}

/** draft -> active -> ended; anything else is a conflict. */
export async function setFeeAgreementStatus(
  deps: FeesDeps,
  actor: FeesActor,
  input: unknown,
): Promise<FeeAgreementView> {
  return withFees(deps, actor, 'fee.write', async (scope) => {
    const data = parseFeeInput(StatusInput, input);
    const current = await loadAgreement(scope, data.agreementId);
    const allowed = data.status === 'active' ? 'draft' : 'active';
    if (current.status !== allowed) {
      throw conflict(`A ${current.status} fee agreement cannot become ${data.status}`);
    }
    const [row] = await scope.tx
      .update(feeAgreement)
      .set({ status: data.status, updatedAt: scope.now })
      .where(and(eq(feeAgreement.workspaceId, actor.workspaceId), eq(feeAgreement.id, current.id)))
      .returning();
    if (row === undefined) throw notFound('Fee agreement not found');
    await record(auditCtx(scope), {
      action: 'fee.agreement_status_changed',
      target: { kind: 'fee_agreement', id: row.id },
      metadata: { from: current.status, to: data.status },
    });
    return row;
  });
}

export async function getFeeAgreement(
  deps: FeesDeps,
  actor: FeesActor,
  input: unknown,
): Promise<FeeAgreementView> {
  return withFees(deps, actor, 'fee.read', async (scope) =>
    loadAgreement(scope, parseFeeInput(AgreementId, input).agreementId),
  );
}

export async function listFeeAgreements(
  deps: FeesDeps,
  actor: FeesActor,
  input: unknown = {},
): Promise<FeeAgreementView[]> {
  return withFees(deps, actor, 'fee.read', async (scope) => {
    const { matterId } = parseFeeInput(ListInput, input);
    return scope.tx
      .select()
      .from(feeAgreement)
      .where(
        and(
          eq(feeAgreement.workspaceId, actor.workspaceId),
          matterId === undefined ? undefined : eq(feeAgreement.matterId, matterId),
        ),
      )
      .orderBy(desc(feeAgreement.createdAt), asc(feeAgreement.id));
  });
}
