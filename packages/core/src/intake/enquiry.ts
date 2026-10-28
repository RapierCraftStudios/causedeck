// The enquiry services (#87, ADR 0047): `logEnquiry`, `updateEnquiry`, `closeEnquiry`,
// `acceptEnquiry`, `listEnquiries` and `getEnquiry`. Each runs through `withIntake`: flag first, then
// membership and the advocate-level policy check, all before any row is touched. An enquiry moves
// logged -> checked (by `runConflictCheck`) -> accepted_as_matter (only through a `new_matter`
// proposal from the automation engine), declined, referred or closed. Nothing here sends anything.
// Audit metadata holds ids and counts, never names or enquiry text.
import { schema } from '@causedeck/db';
import {
  AcceptEnquiryInput,
  CloseEnquiryInput,
  EnquiryIdInput,
  LogEnquiryInput,
  UpdateEnquiryInput,
  type EnquiryChannel,
  type EnquiryPartySide,
  type EnquiryStatus,
} from '@causedeck/validators/enquiry';
import { and, asc, desc, eq } from 'drizzle-orm';

import { submitProposals } from '../automation/index.ts';
import { type AuditMetadataValue, record } from '../audit/index.ts';
import { conflict, notFound } from '../shared/errors.ts';

import { parse, withIntake, type IntakeActor, type IntakeDeps, type IntakeScope } from './scope.ts';

const { enquiry, enquiryParty } = schema;

export interface EnquiryPartyView {
  name: string;
  side: EnquiryPartySide;
}

export interface EnquiryView {
  id: string;
  status: EnquiryStatus;
  channel: EnquiryChannel;
  enquirerName: string;
  phone: string | null;
  email: string | null;
  summary: string;
  practiceArea: string | null;
  receivedAt: Date;
  proposalId: string | null;
  closedAt: Date | null;
  closedReason: string | null;
  parties: EnquiryPartyView[];
}

type EnquiryRow = typeof enquiry.$inferSelect;

const NO_EVENTS = {
  emit() {
    // Staging a proposal has no event subscribers.
  },
};

async function partiesOf(scope: IntakeScope, enquiryId: string): Promise<EnquiryPartyView[]> {
  const rows = await scope.tx
    .select({ name: enquiryParty.name, side: enquiryParty.side })
    .from(enquiryParty)
    .where(
      and(
        eq(enquiryParty.workspaceId, scope.actor.workspaceId),
        eq(enquiryParty.enquiryId, enquiryId),
      ),
    )
    .orderBy(asc(enquiryParty.createdAt), asc(enquiryParty.id));
  return rows.map((row) => ({ name: row.name, side: row.side as EnquiryPartySide }));
}

function view(row: EnquiryRow, parties: EnquiryPartyView[]): EnquiryView {
  return {
    id: row.id,
    status: row.status as EnquiryStatus,
    channel: row.channel as EnquiryChannel,
    enquirerName: row.enquirerName,
    phone: row.phone,
    email: row.email,
    summary: row.summary,
    practiceArea: row.practiceArea,
    receivedAt: row.receivedAt,
    proposalId: row.proposalId,
    closedAt: row.closedAt,
    closedReason: row.closedReason,
    parties,
  };
}

/** The enquiry in the actor's workspace, or NOT_FOUND (another workspace's id is never visible). */
export async function loadEnquiry(scope: IntakeScope, enquiryId: string): Promise<EnquiryRow> {
  const [row] = await scope.tx
    .select()
    .from(enquiry)
    .where(and(eq(enquiry.workspaceId, scope.actor.workspaceId), eq(enquiry.id, enquiryId)));
  if (row === undefined) throw notFound('Enquiry not found');
  return row;
}

function auditEnquiry(
  scope: IntakeScope,
  action: 'enquiry.logged' | 'enquiry.updated' | 'enquiry.closed' | 'enquiry.accepted',
  enquiryId: string,
  metadata: Record<string, AuditMetadataValue>,
) {
  return record(
    {
      db: scope.tx,
      workspaceId: scope.actor.workspaceId,
      actor: { userId: scope.actor.userId, kind: 'user' },
    },
    { action, target: { kind: 'enquiry', id: enquiryId }, metadata },
  );
}

function requireOpen(row: EnquiryRow): void {
  if (row.status === 'closed' || row.status === 'accepted_as_matter') {
    throw conflict('This enquiry can no longer be changed');
  }
}

async function replaceParties(
  scope: IntakeScope,
  enquiryId: string,
  parties: readonly EnquiryPartyView[],
): Promise<void> {
  await scope.tx
    .delete(enquiryParty)
    .where(
      and(
        eq(enquiryParty.workspaceId, scope.actor.workspaceId),
        eq(enquiryParty.enquiryId, enquiryId),
      ),
    );
  if (parties.length === 0) return;
  await scope.tx.insert(enquiryParty).values(
    parties.map((party) => ({
      workspaceId: scope.actor.workspaceId,
      enquiryId,
      name: party.name,
      side: party.side,
    })),
  );
}

export async function logEnquiry(
  deps: IntakeDeps,
  actor: IntakeActor,
  input: unknown,
): Promise<EnquiryView> {
  return withIntake(deps, actor, 'enquiry.write', async (scope) => {
    const data = parse(LogEnquiryInput, input);
    const [row] = await scope.tx
      .insert(enquiry)
      .values({
        workspaceId: actor.workspaceId,
        enquirerName: data.enquirerName,
        channel: data.channel,
        phone: data.phone ?? null,
        email: data.email ?? null,
        summary: data.summary,
        practiceArea: data.practiceArea ?? null,
        receivedAt: data.receivedAt ?? scope.now,
        createdBy: actor.userId,
      })
      .returning();
    if (row === undefined) throw new Error('enquiry insert returned no row');
    await replaceParties(scope, row.id, data.parties);
    await auditEnquiry(scope, 'enquiry.logged', row.id, {
      channel: data.channel,
      parties: data.parties.length,
    });
    return view(row, data.parties);
  });
}

export async function updateEnquiry(
  deps: IntakeDeps,
  actor: IntakeActor,
  input: unknown,
): Promise<EnquiryView> {
  return withIntake(deps, actor, 'enquiry.write', async (scope) => {
    const data = parse(UpdateEnquiryInput, input);
    const current = await loadEnquiry(scope, data.enquiryId);
    requireOpen(current);
    const set: Partial<typeof enquiry.$inferInsert> = { updatedAt: scope.now };
    const fields: string[] = [];
    const assign = <K extends keyof typeof enquiry.$inferInsert>(
      key: K,
      value: (typeof enquiry.$inferInsert)[K] | undefined,
    ) => {
      if (value === undefined) return;
      set[key] = value;
      fields.push(key);
    };
    assign('enquirerName', data.enquirerName);
    assign('channel', data.channel);
    assign('phone', data.phone);
    assign('email', data.email);
    assign('summary', data.summary);
    assign('practiceArea', data.practiceArea);
    assign('status', data.status);
    if (data.parties !== undefined) {
      await replaceParties(scope, current.id, data.parties);
      fields.push('parties');
      // A changed set of names needs a fresh conflict check.
      if (current.status === 'checked' && data.status === undefined) set.status = 'logged';
    }
    const [row] = await scope.tx
      .update(enquiry)
      .set(set)
      .where(and(eq(enquiry.workspaceId, actor.workspaceId), eq(enquiry.id, current.id)))
      .returning();
    if (row === undefined) throw notFound('Enquiry not found');
    await auditEnquiry(scope, 'enquiry.updated', row.id, { fields: fields.join(',') });
    return view(row, await partiesOf(scope, row.id));
  });
}

export async function closeEnquiry(
  deps: IntakeDeps,
  actor: IntakeActor,
  input: unknown,
): Promise<EnquiryView> {
  return withIntake(deps, actor, 'enquiry.write', async (scope) => {
    const data = parse(CloseEnquiryInput, input);
    const current = await loadEnquiry(scope, data.enquiryId);
    if (current.status === 'closed') throw conflict('This enquiry is already closed');
    const [row] = await scope.tx
      .update(enquiry)
      .set({
        status: 'closed',
        closedAt: scope.now,
        closedReason: data.reason ?? null,
        updatedAt: scope.now,
      })
      .where(and(eq(enquiry.workspaceId, actor.workspaceId), eq(enquiry.id, current.id)))
      .returning();
    if (row === undefined) throw notFound('Enquiry not found');
    await auditEnquiry(scope, 'enquiry.closed', row.id, { from: current.status });
    return view(row, await partiesOf(scope, row.id));
  });
}

/**
 * Accept an enquiry as a matter. A matter is never created here: a `new_matter` proposal goes to the
 * automation engine (always a card for the advocate) and the enquiry records its id. The enquiry must
 * have a conflict check on record that is still current.
 */
export async function acceptEnquiry(
  deps: IntakeDeps,
  actor: IntakeActor,
  input: unknown,
): Promise<EnquiryView> {
  return withIntake(deps, actor, 'enquiry.write', async (scope) => {
    const data = parse(AcceptEnquiryInput, input);
    const current = await loadEnquiry(scope, data.enquiryId);
    requireOpen(current);
    if (current.status !== 'checked') throw conflict('Run the conflict check before accepting');
    const { items } = await submitProposals(
      { db: scope.tx, events: NO_EVENTS, now: () => scope.now },
      { workspaceId: actor.workspaceId, userId: actor.userId },
      [
        {
          kind: 'new_matter',
          source: { type: 'manual', input: 'form', ref: current.id },
          payload: {
            title: data.title ?? current.summary.slice(0, 300),
            practiceArea: current.practiceArea,
          },
          confidence: null,
        },
      ],
    );
    const item = items[0];
    const proposalId = item?.proposalId ?? null;
    if (proposalId === null) {
      throw conflict(item?.reason ?? 'The matter proposal could not be created');
    }
    const [row] = await scope.tx
      .update(enquiry)
      .set({ status: 'accepted_as_matter', proposalId, updatedAt: scope.now })
      .where(and(eq(enquiry.workspaceId, actor.workspaceId), eq(enquiry.id, current.id)))
      .returning();
    if (row === undefined) throw notFound('Enquiry not found');
    await auditEnquiry(scope, 'enquiry.accepted', row.id, { proposalId });
    return view(row, await partiesOf(scope, row.id));
  });
}

export async function getEnquiry(
  deps: IntakeDeps,
  actor: IntakeActor,
  input: unknown,
): Promise<EnquiryView> {
  return withIntake(deps, actor, 'enquiry.read', async (scope) => {
    const data = parse(EnquiryIdInput, input);
    const row = await loadEnquiry(scope, data.enquiryId);
    return view(row, await partiesOf(scope, row.id));
  });
}

export async function listEnquiries(deps: IntakeDeps, actor: IntakeActor): Promise<EnquiryView[]> {
  return withIntake(deps, actor, 'enquiry.read', async (scope) => {
    const rows = await scope.tx
      .select()
      .from(enquiry)
      .where(eq(enquiry.workspaceId, actor.workspaceId))
      .orderBy(desc(enquiry.receivedAt), asc(enquiry.id));
    return Promise.all(rows.map(async (row) => view(row, await partiesOf(scope, row.id))));
  });
}
