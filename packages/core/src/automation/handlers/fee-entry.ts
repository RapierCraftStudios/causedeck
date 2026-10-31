// `fee_entry` (#83): a proposed fee agreement, always L2 (money is always a proposal). Accepting it
// writes a draft `fee_agreement`; the lawyer activates it later. The handler inserts through the
// schema rather than importing the fees domain, which imports automation (no dependency cycle).
// Undo deletes the draft while nothing cites it.
import { schema } from '@causedeck/db';
import { FeeAgreementInput } from '@causedeck/validators/fees';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';

import { conflict, notFound } from '../../shared/errors.ts';
import type { ProposalHandler } from '../types.ts';

import { parsePayload } from './common.ts';

type Payload = z.output<typeof FeeAgreementInput>;

const { feeAgreement, matter, person } = schema;

export const feeEntryHandler: ProposalHandler<Payload> = {
  kind: 'fee_entry',
  enabled: true,
  validate: (payload) => parsePayload(FeeAgreementInput, payload),

  async apply(scope, ctx) {
    const ws = scope.actor.workspaceId;
    const p = ctx.payload;
    const [m] = await scope.tx
      .select({ id: matter.id })
      .from(matter)
      .where(and(eq(matter.workspaceId, ws), eq(matter.id, p.matterId)));
    if (m === undefined) throw notFound('Matter not found');
    const [who] = await scope.tx
      .select({ id: person.id })
      .from(person)
      .where(and(eq(person.workspaceId, ws), eq(person.id, p.personId)));
    if (who === undefined) throw notFound('Person not found');
    const [row] = await scope.tx
      .insert(feeAgreement)
      .values({
        workspaceId: ws,
        matterId: p.matterId,
        personId: p.personId,
        basis: p.basis,
        amountPaise: p.amountPaise,
        gstTreatment: p.gstTreatment,
        startsOn: p.startsOn,
        endsOn: p.endsOn ?? null,
        notes: p.notes ?? null,
        createdBy: scope.actor.userId,
      })
      .returning({ id: feeAgreement.id });
    if (row === undefined) throw new Error('fee_agreement insert returned no row');
    return {
      undoPayload: { agreementId: row.id },
      entityRefs: { matterId: p.matterId },
      summary: 'Added a draft fee agreement',
      matterId: p.matterId,
    };
  },

  async undo(scope, activity) {
    const agreementId = activity.undoPayload?.['agreementId'];
    if (typeof agreementId !== 'string')
      throw conflict('Nothing to undo: the agreement id is missing');
    const [row] = await scope.tx
      .select({ status: feeAgreement.status })
      .from(feeAgreement)
      .where(
        and(
          eq(feeAgreement.workspaceId, scope.actor.workspaceId),
          eq(feeAgreement.id, agreementId),
        ),
      );
    if (row === undefined) return;
    if (row.status !== 'draft') throw conflict('The fee agreement is already in use');
    try {
      await scope.tx
        .delete(feeAgreement)
        .where(
          and(
            eq(feeAgreement.workspaceId, scope.actor.workspaceId),
            eq(feeAgreement.id, agreementId),
          ),
        );
    } catch {
      throw conflict('The fee agreement is already in use');
    }
  },
};
