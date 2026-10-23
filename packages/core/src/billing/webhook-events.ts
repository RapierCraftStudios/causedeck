// Billing webhook persistence (#204), for the Razorpay webhook route in `apps/api`. Routes hold no
// SQL, so the two database steps of a delivery live here:
//
// * `resolveBillingWorkspace` maps a provider subscription id to the workspace that stored it,
//   through the owner-defined `app_billing_workspace_for_provider_subscription` (0011): the
//   webhook has no workspace and `subscription` is under FORCE row-level security. Payload
//   metadata (notes, account id) is never consulted.
// * `recordBillingEvent` stores the event once per provider event id inside the workspace scope,
//   and runs `afterInsert` (the enqueue) in the same transaction, so a failed enqueue rolls the
//   row back and the provider's retry is not mistaken for a duplicate.
import { isUuid, schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';

type Queryable = Database | Transaction;
import { sql } from 'drizzle-orm';

const { billingEvent } = schema;

/** The workspace owning `providerSubscriptionId` at `provider`, or `null` when none does. */
export async function resolveBillingWorkspace(
  db: Queryable,
  provider: string,
  providerSubscriptionId: string,
): Promise<string | null> {
  const [row] = await db.execute<{ workspace_id: string | null }>(
    sql`select app_billing_workspace_for_provider_subscription(${provider}, ${providerSubscriptionId})::text as workspace_id`,
  );
  const workspaceId = row?.workspace_id ?? null;
  return isUuid(workspaceId) ? workspaceId : null;
}

export interface BillingEventInput {
  workspaceId: string;
  providerEventId: string;
  type: string;
  payloadHash: string;
  /** The minimised webhook event (`minimiseWebhookEvent`); never contact data. */
  payload: unknown;
}

/**
 * Insert the event unless its provider event id is already stored. Returns `inserted: false` for a
 * replay, without calling `afterInsert`.
 */
export async function recordBillingEvent(
  db: Queryable,
  input: BillingEventInput,
  afterInsert?: () => Promise<void>,
): Promise<{ inserted: boolean }> {
  return withWorkspace(db, { workspaceId: input.workspaceId }, async (tx) => {
    const inserted = await tx
      .insert(billingEvent)
      .values({
        providerEventId: input.providerEventId,
        workspaceId: input.workspaceId,
        type: input.type,
        payloadHash: input.payloadHash,
        payload: input.payload,
      })
      .onConflictDoNothing({ target: billingEvent.providerEventId })
      .returning({ providerEventId: billingEvent.providerEventId });
    if (inserted.length === 0) return { inserted: false };
    await afterInsert?.();
    return { inserted: true };
  });
}
