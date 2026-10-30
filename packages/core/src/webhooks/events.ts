// Change events (#626, #487 part 3): `emitWebhookEvent` turns a change on a watched item into one
// pending `webhook_delivery` per matching, active endpoint of the workspace. The payload is
// content-free (D-048, D-050): ids, the CNR, the kinds of change, provenance and the source's
// licensor, never party names, order text or anything about a judge. A sensitive matter, or one
// that cannot be read in the workspace, produces no event. Re-emitting the same `eventKey` is a
// no-op per endpoint (unique key), so a retried poll never delivers twice.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, eq, sql } from 'drizzle-orm';

import { isDemoWorkspace } from '../shared/index.ts';

const { caseStatusSnapshot, caseWatch, matter, source, webhookDelivery, webhookEndpoint } = schema;

type Queryable = Database | Transaction;

export type WebhookEventKind = schema.WebhookEventType;

export interface WebhookEventInput {
  workspaceId: string;
  type: WebhookEventKind;
  /** Idempotency key of the source change (e.g. `status:<snapshotId>:order`). */
  eventKey: string;
  sourceId: string;
  /** Kinds of change (`next_date`, `stage`, `bench`, `order`, `cause_list_match`). */
  changes: readonly string[];
  /** The watched matter; a sensitive matter never emits. */
  matterId?: string | null;
  watchId?: string | null;
  snapshotId?: string | null;
  publicationId?: string | null;
  /** Rows of a cause list that matched (a count, never the rows). */
  matchCount?: number;
}

export interface WebhookEmitDeps {
  db: Queryable;
  /** Queue the delivery job for these new deliveries; the sweep covers any that fail to enqueue. */
  enqueue?: (job: { workspaceId: string; deliveryId: string }) => Promise<unknown>;
  now?: () => Date;
}

/** Create the deliveries for one change; returns how many were created (0 when none matched). */
export async function emitWebhookEvent(
  deps: WebhookEmitDeps,
  input: WebhookEventInput,
): Promise<number> {
  const { workspaceId } = input;
  const created = await withWorkspace(deps.db, { workspaceId }, async (tx) => {
    // A demo workspace sends nothing outside it (#93): no delivery is created.
    if (await isDemoWorkspace(tx, workspaceId)) return [];
    if (input.matterId !== undefined && input.matterId !== null) {
      const [row] = await tx
        .select({ sensitive: matter.sensitive })
        .from(matter)
        .where(and(eq(matter.workspaceId, workspaceId), eq(matter.id, input.matterId)));
      if (row === undefined || row.sensitive) return [];
    }
    const endpoints = await tx
      .select({ id: webhookEndpoint.id })
      .from(webhookEndpoint)
      .where(
        and(
          eq(webhookEndpoint.workspaceId, workspaceId),
          eq(webhookEndpoint.active, true),
          sql`${input.type} = any(${webhookEndpoint.events})`,
        ),
      );
    if (endpoints.length === 0) return [];

    let cnr: string | null = null;
    if (input.watchId !== undefined && input.watchId !== null) {
      const [watch] = await tx
        .select({ cnr: caseWatch.cnr })
        .from(caseWatch)
        .where(and(eq(caseWatch.workspaceId, workspaceId), eq(caseWatch.id, input.watchId)));
      cnr = watch?.cnr ?? null;
    }
    let fetchedAt: Date = deps.now?.() ?? new Date();
    if (input.snapshotId !== undefined && input.snapshotId !== null) {
      const [snapshot] = await tx
        .select({ fetchedAt: caseStatusSnapshot.fetchedAt })
        .from(caseStatusSnapshot)
        .where(
          and(
            eq(caseStatusSnapshot.workspaceId, workspaceId),
            eq(caseStatusSnapshot.id, input.snapshotId),
          ),
        );
      if (snapshot !== undefined) fetchedAt = snapshot.fetchedAt;
    }
    const [origin] = await tx
      .select({ owner: source.owner })
      .from(source)
      .where(eq(source.id, input.sourceId));

    const payload = {
      type: input.type,
      occurredAt: fetchedAt.toISOString(),
      workspaceId,
      matterId: input.matterId ?? null,
      cnr,
      changes: [...input.changes],
      publicationId: input.publicationId ?? null,
      matchCount: input.matchCount ?? null,
      provenance: { sourceId: input.sourceId, fetchedAt: fetchedAt.toISOString() },
      sourceLicense: origin?.owner ?? null,
    };
    return tx
      .insert(webhookDelivery)
      .values(
        endpoints.map((endpoint) => ({
          workspaceId,
          endpointId: endpoint.id,
          eventType: input.type,
          eventKey: input.eventKey,
          payload,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: webhookDelivery.id });
  });
  for (const delivery of created) {
    try {
      await deps.enqueue?.({ workspaceId, deliveryId: delivery.id });
    } catch {
      // The sweep re-enqueues a pending delivery; a failed enqueue never fails the poll.
    }
  }
  return created.length;
}
