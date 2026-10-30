// The fee forms' helpers (#963): the clients a form can pick, and the stored supplier state. The
// supplier state is: the two-digit GST state code the advocate's
// invoices are issued from, kept on `workspace_settings` so the editor stops asking each time. Read
// with `fee.read`, written with `fee.write`; the same flag and role gate as every fees service.
import { schema } from '@causedeck/db';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { record } from '../audit/index.ts';

import { auditCtx, parseFeeInput, withFees, type FeesActor, type FeesDeps } from './scope.ts';

const { person, workspaceSettings } = schema;

const CLIENT_PICKER_LIMIT = 200;

const SupplierStateInput = z.strictObject({ stateCode: z.string().regex(/^[0-9]{2}$/) });

/** The stored supplier state code, or null when none has been saved yet. */
export async function getFeeSupplierState(
  deps: FeesDeps,
  actor: FeesActor,
): Promise<string | null> {
  return withFees(deps, actor, 'fee.read', async (scope) => {
    const [row] = await scope.tx
      .select({ code: workspaceSettings.feeSupplierStateCode })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, actor.workspaceId));
    return row?.code ?? null;
  });
}

/** Stores the supplier state code; writes (and audits) only when it changes. Returns the stored code. */
export async function setFeeSupplierState(
  deps: FeesDeps,
  actor: FeesActor,
  input: unknown,
): Promise<string> {
  return withFees(deps, actor, 'fee.write', async (scope) => {
    const { stateCode } = parseFeeInput(SupplierStateInput, input);
    const [current] = await scope.tx
      .select({ code: workspaceSettings.feeSupplierStateCode })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, actor.workspaceId));
    if (current?.code === stateCode) return stateCode;
    await scope.tx
      .insert(workspaceSettings)
      .values({ workspaceId: actor.workspaceId, feeSupplierStateCode: stateCode })
      .onConflictDoUpdate({
        target: workspaceSettings.workspaceId,
        set: { feeSupplierStateCode: stateCode, updatedAt: scope.now },
      });
    await record(auditCtx(scope), {
      action: 'fee.supplier_state_set',
      target: { kind: 'workspace_settings', id: actor.workspaceId },
      metadata: { stateCode },
    });
    return stateCode;
  });
}

/** The workspace's clients (people of kind `client`) by name, for the client picker. */
export async function listFeeClients(
  deps: FeesDeps,
  actor: FeesActor,
): Promise<{ id: string; name: string }[]> {
  return withFees(deps, actor, 'fee.read', async (scope) =>
    scope.tx
      .select({ id: person.id, name: person.name })
      .from(person)
      .where(and(eq(person.workspaceId, actor.workspaceId), eq(person.kind, 'client')))
      .orderBy(asc(person.name), asc(person.id))
      .limit(CLIENT_PICKER_LIMIT),
  );
}
