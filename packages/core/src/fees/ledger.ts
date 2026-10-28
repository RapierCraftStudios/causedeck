// Client ledger services (#83 part 3): expenses and receipts, the list and the balance. The maths
// is `@causedeck/billing/fees` (pure); this persists the entries. Records money only: nothing moves.
import { clientBalance, recordExpense, recordReceipt } from '@causedeck/billing/fees';
import { schema } from '@causedeck/db';
import type { LedgerEntry } from '@causedeck/validators/fees';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { record } from '../audit/index.ts';

import { requireMatterAndPerson } from './agreements.ts';
import {
  auditCtx,
  parse,
  withFees,
  type FeesActor,
  type FeesDeps,
  type FeesScope,
} from './scope.ts';

const { clientLedgerEntry } = schema;

export type LedgerEntryView = typeof clientLedgerEntry.$inferSelect;

const PersonScope = z.strictObject({ personId: z.uuid(), matterId: z.uuid().optional() });

/** Inserts a validated ledger entry (no authorisation: callers are already inside `withFees`). */
export async function insertLedgerEntry(
  scope: FeesScope,
  entry: LedgerEntry,
): Promise<LedgerEntryView> {
  const [row] = await scope.tx
    .insert(clientLedgerEntry)
    .values({
      workspaceId: scope.actor.workspaceId,
      personId: entry.personId,
      matterId: entry.matterId ?? null,
      invoiceId: entry.invoiceId ?? null,
      kind: entry.kind,
      direction: entry.direction,
      amountPaise: entry.amountPaise,
      description: entry.description,
      occurredOn: entry.occurredOn,
      createdBy: scope.actor.userId,
    })
    .returning();
  if (row === undefined) throw new Error('client_ledger_entry insert returned no row');
  await record(auditCtx(scope), {
    action: 'fee.ledger_entry_recorded',
    target: { kind: 'client_ledger_entry', id: row.id },
    metadata: { kind: row.kind, direction: row.direction },
  });
  return row;
}

/** A disbursement paid for the client: a debit. */
export async function recordClientExpense(
  deps: FeesDeps,
  actor: FeesActor,
  input: unknown,
): Promise<LedgerEntryView> {
  return withFees(deps, actor, 'fee.write', async (scope) => {
    const entry = parse(
      z.custom<Parameters<typeof recordExpense>[0]>((v) => typeof v === 'object' && v !== null),
      input,
    );
    const checked = recordExpense(entry);
    await requireMatterAndPerson(scope, checked.matterId, checked.personId);
    return insertLedgerEntry(scope, checked);
  });
}

/** Money received from the client: a credit. */
export async function recordClientReceipt(
  deps: FeesDeps,
  actor: FeesActor,
  input: unknown,
): Promise<LedgerEntryView> {
  return withFees(deps, actor, 'fee.write', async (scope) => {
    const entry = parse(
      z.custom<Parameters<typeof recordReceipt>[0]>((v) => typeof v === 'object' && v !== null),
      input,
    );
    const checked = recordReceipt(entry);
    await requireMatterAndPerson(scope, checked.matterId, checked.personId);
    return insertLedgerEntry(scope, checked);
  });
}

async function entriesOf(scope: FeesScope, personId: string, matterId?: string) {
  return scope.tx
    .select()
    .from(clientLedgerEntry)
    .where(
      and(
        eq(clientLedgerEntry.workspaceId, scope.actor.workspaceId),
        eq(clientLedgerEntry.personId, personId),
        matterId === undefined ? undefined : eq(clientLedgerEntry.matterId, matterId),
      ),
    )
    .orderBy(
      asc(clientLedgerEntry.occurredOn),
      asc(clientLedgerEntry.createdAt),
      asc(clientLedgerEntry.id),
    );
}

export async function listLedger(
  deps: FeesDeps,
  actor: FeesActor,
  input: unknown,
): Promise<LedgerEntryView[]> {
  return withFees(deps, actor, 'fee.read', async (scope) => {
    const data = parse(PersonScope, input);
    return entriesOf(scope, data.personId, data.matterId);
  });
}

/** What the client owes, in paise (negative: the client is in credit). */
export async function getClientBalance(
  deps: FeesDeps,
  actor: FeesActor,
  input: unknown,
): Promise<number> {
  return withFees(deps, actor, 'fee.read', async (scope) => {
    const data = parse(PersonScope, input);
    const rows = await entriesOf(scope, data.personId, data.matterId);
    return clientBalance(
      rows.map((r) => ({
        personId: r.personId,
        kind: r.kind as LedgerEntry['kind'],
        direction: r.direction as LedgerEntry['direction'],
        amountPaise: r.amountPaise,
        description: r.description ?? '',
        occurredOn: r.occurredOn,
      })),
    );
  });
}
