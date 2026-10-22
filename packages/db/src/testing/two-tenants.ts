// Two-tenant fixture for the cross-tenant suite (#19, #209): workspaces A and B, users `ua` (owner
// of A), `ub` (owner of B) and `uboth` (an advocate in both), and one seed row in every tenant
// table of each workspace. Tenant rows are written inside their own workspace scope, as application
// code must under FORCE RLS. Ids are random, so it works inside `withTestDb` (rolled back) and on
// committed data (the api and web suites, whose users come from Better Auth).
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import type { Database, Transaction } from '../client.ts';
import { registeredGlobalOrWorkspaceTables, registeredTenantTables } from '../rls-policies.ts';
import { withWorkspace } from '../rls.ts';
import { adapterParseRun } from '../schema/adapters.ts';
import { aiCall, aiCallResult } from '../schema/audit.ts';
import { invitation, member, organization, user } from '../schema/auth.ts';
import { billingEvent, entitlement, plan, subscription, usageCounter } from '../schema/billing.ts';
import { bench, courtHall, forum } from '../schema/court.ts';
import { anchor, document, documentPage } from '../schema/documents.ts';
import { workspaceFeatureFlag } from '../schema/flags.ts';
import { jobEffect } from '../schema/job-effect.ts';
import { deletionJob, exportJob } from '../schema/lifecycle.ts';
import { matter } from '../schema/matter-graph.ts';
import { organisation, person, roleEdge } from '../schema/people.ts';
import { proceeding, proceedingLink, proceedingStateChange } from '../schema/proceedings.ts';
import { appearance, hearing, listing, obligation, order, task } from '../schema/docket.ts';
import { benchChangeAlert, benchRoster, benchRosterEntry } from '../schema/roster.ts';
import { matterRestriction } from '../schema/matter-restriction.ts';
import { notification, notificationPref, notificationSetting } from '../schema/notifications.ts';
import {
  budgetOverride,
  usageEvent,
  usagePeriodSummary,
  usageReservation,
} from '../schema/usage.ts';
import { saasInvoice, saasInvoiceLine } from '../schema/saas-invoice.ts';
import { supportSession } from '../schema/staff.ts';
import { blob, workspaceKey } from '../schema/storage.ts';
import { workspaceIntegration } from '../schema/workspace-integration.ts';
import { workspaceSettings, workspaceSlugHistory } from '../schema/workspace.ts';

type Queryable = Database | Transaction;

/** The global plan row the billing seed rows point at. */
export const TWO_TENANTS_PLAN_ID = 'xt_seed_plan';

export interface SeedContext {
  workspaceId: string;
  /** The workspace's owner (`ua` for A, `ub` for B). */
  ownerId: string;
  /** Unique per seeding run, for values with global unique constraints. */
  tag: string;
}

/** What a seeder wrote: the ids (or keys) that identify the row. */
export type SeedRow = Record<string, string>;

/** Writes one row into its table for `ctx.workspaceId`, on a transaction scoped to it. */
export type TenantSeeder = (tx: Transaction, ctx: SeedContext) => Promise<SeedRow>;

/** A draft SaaS invoice for the workspace (the seed for `saas_invoice` and `saas_invoice_line`). */
async function seedDraftInvoice(tx: Transaction, workspaceId: string): Promise<string> {
  const party = { legalName: 'XT Seed', address: 'Seed Road', gstin: null, stateCode: '29' };
  const rows = await tx
    .insert(saasInvoice)
    .values({
      workspaceId,
      series: 'XT',
      fy: '26-27',
      supplier: party,
      recipient: party,
      placeOfSupplyStateCode: '29',
    })
    .returning({ id: saasInvoice.id });
  return first(rows, 'saas_invoice').id;
}

function first<T>(rows: T[], table: string): T {
  const [row] = rows;
  if (row === undefined) throw new Error(`two-tenants: ${table} insert returned no row`);
  return row;
}

async function newUser(q: Queryable, label: string): Promise<string> {
  const rows = await q
    .insert(user)
    .values({ name: `Advocate ${label}`, email: `${label}-${randomUUID()}@example.test` })
    .returning({ id: user.id });
  return first(rows, 'user').id;
}

/** The invite-token hash `@causedeck/core` stores (sha256 hex of the plaintext token). */
export function invitationTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A custom (workspace-owned) forum, as an A0 forum a workspace adds itself (#344). */
async function seedForum(tx: Transaction, workspaceId: string, tag: string): Promise<string> {
  const rows = await tx
    .insert(forum)
    .values({
      workspaceId,
      code: `xt.${tag}.${randomUUID().slice(0, 8)}`,
      court: 'Seed District Court',
      jurisdictionKind: 'district',
    })
    .returning({ id: forum.id });
  return first(rows, 'forum').id;
}

/** A matter of the workspace (#345), for the matter graph and restriction seeds. */
async function seedMatter(tx: Transaction, workspaceId: string, tag: string): Promise<string> {
  const rows = await tx
    .insert(matter)
    .values({ workspaceId, title: `XT Matter ${tag}`, practiceArea: 'civil' })
    .returning({ id: matter.id });
  return first(rows, 'matter').id;
}

/** A proceeding of a fresh matter before a custom forum (#346), still at the filing stage. */
async function seedProceeding(tx: Transaction, workspaceId: string, tag: string): Promise<string> {
  const matterId = await seedMatter(tx, workspaceId, tag);
  const forumId = await seedForum(tx, workspaceId, tag);
  const rows = await tx
    .insert(proceeding)
    .values({
      workspaceId,
      matterId,
      forumId,
      caseTypeCode: 'WP',
      caseTypeRaw: 'W.P.',
      filingNo: `F-${tag}`,
      sourceType: 'manual',
    })
    .returning({ id: proceeding.id });
  return first(rows, 'proceeding').id;
}

/** A fictional party (#348). */
async function seedPerson(tx: Transaction, workspaceId: string, tag: string): Promise<string> {
  const rows = await tx
    .insert(person)
    .values({ workspaceId, name: `Party ${tag}`, kind: 'party', sourceType: 'manual' })
    .returning({ id: person.id });
  return first(rows, 'person').id;
}

/** A document of a fresh matter (#345). */
async function seedDocument(tx: Transaction, workspaceId: string, tag: string): Promise<string> {
  const matterId = await seedMatter(tx, workspaceId, tag);
  const id = randomUUID();
  const rows = await tx
    .insert(document)
    .values({
      id,
      workspaceId,
      matterId,
      kind: 'pleading',
      storageKey: `ws/${workspaceId}/document/${id}`,
      sha256: createHash('sha256').update(id).digest('hex'),
    })
    .returning({ id: document.id });
  return first(rows, 'document').id;
}

/** A listing of a fresh proceeding (#347), on the daily list. */
async function seedListing(tx: Transaction, workspaceId: string, tag: string): Promise<string> {
  const proceedingId = await seedProceeding(tx, workspaceId, tag);
  const rows = await tx
    .insert(listing)
    .values({
      workspaceId,
      proceedingId,
      listDate: '2026-11-02',
      listType: 'daily',
      stageRaw: 'FOR ADMISSION',
      canonical: true,
      sourceType: 'manual',
    })
    .returning({ id: listing.id });
  return first(rows, 'listing').id;
}

/** A draft roster of a fresh custom forum (#384), and a bench of that forum. */
async function seedBenchRoster(
  tx: Transaction,
  workspaceId: string,
  tag: string,
): Promise<{ forumId: string; rosterId: string; benchId: string }> {
  const forumId = await seedForum(tx, workspaceId, `${tag}-roster`);
  const rosters = await tx
    .insert(benchRoster)
    .values({ workspaceId, forumId, effectiveFrom: '2026-11-01', version: 1 })
    .returning({ id: benchRoster.id });
  const benches = await tx
    .insert(bench)
    .values({ workspaceId, forumId, judges: ['Judge B'], benchKind: 'single' })
    .returning({ id: bench.id });
  return {
    forumId,
    rosterId: first(rosters, 'bench_roster').id,
    benchId: first(benches, 'bench').id,
  };
}

/** A hearing of a fresh listing (#347). */
async function seedHearing(tx: Transaction, workspaceId: string, tag: string): Promise<string> {
  const listingId = await seedListing(tx, workspaceId, tag);
  const rows = await tx
    .insert(hearing)
    .values({ workspaceId, listingId, heldOn: '2026-11-02', sourceType: 'manual' })
    .returning({ id: hearing.id });
  return first(rows, 'hearing').id;
}

/** An open obligation of a fresh matter (#347). */
async function seedObligation(tx: Transaction, workspaceId: string, tag: string): Promise<string> {
  const matterId = await seedMatter(tx, workspaceId, tag);
  const rows = await tx
    .insert(obligation)
    .values({
      workspaceId,
      matterId,
      source: 'internal',
      description: 'File the counter affidavit',
      sourceType: 'manual',
    })
    .returning({ id: obligation.id });
  return first(rows, 'obligation').id;
}

/** Tenant tables and global-or-workspace reference tables: every table the suite seeds. */
function seededTables(): string[] {
  return [...registeredTenantTables(), ...registeredGlobalOrWorkspaceTables()];
}

/**
 * One seeder per tenant table. A table registered for RLS without a seeder here fails the
 * cross-tenant registry test, so a new tenant table cannot skip the suite.
 */
export const TENANT_SEEDERS: Record<string, TenantSeeder> = {
  member: async (tx, { workspaceId, tag }) => {
    const userId = await newUser(tx, `viewer-${tag}`);
    const rows = await tx
      .insert(member)
      .values({ organizationId: workspaceId, userId, role: 'viewer' })
      .returning({ id: member.id });
    return { memberId: first(rows, 'member').id, userId };
  },
  invitation: async (tx, { workspaceId, ownerId, tag }) => {
    const token = randomBytes(32).toString('base64url');
    const rows = await tx
      .insert(invitation)
      .values({
        organizationId: workspaceId,
        email: `invitee-${tag}-${randomUUID()}@example.test`,
        role: 'viewer',
        inviterId: ownerId,
        tokenHash: invitationTokenHash(token),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: invitation.id, email: invitation.email });
    const row = first(rows, 'invitation');
    return { invitationId: row.id, email: row.email, token };
  },
  workspace_settings: async (tx, { workspaceId }) => {
    await tx.insert(workspaceSettings).values({ workspaceId });
    return { workspaceId };
  },
  workspace_slug_history: async (tx, { workspaceId, tag }) => {
    const slug = `xt-old-${tag}-${randomUUID().slice(0, 8)}`;
    await tx.insert(workspaceSlugHistory).values({
      workspaceId,
      slug,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
    return { slug };
  },
  job_effect: async (tx, { workspaceId }) => {
    const rows = await tx
      .insert(jobEffect)
      .values({ workspaceId, jobName: 'xt.seed', idempotencyKey: randomUUID() })
      .returning({ id: jobEffect.id });
    return { jobEffectId: first(rows, 'job_effect').id };
  },
  subscription: async (tx, { workspaceId }) => {
    const rows = await tx
      .insert(subscription)
      .values({ workspaceId, planId: TWO_TENANTS_PLAN_ID, status: 'active' })
      .returning({ id: subscription.id });
    return { subscriptionId: first(rows, 'subscription').id };
  },
  entitlement: async (tx, { workspaceId }) => {
    const key = `xt.seed.${randomUUID()}`;
    await tx.insert(entitlement).values({ workspaceId, key, value: { seeded: true } });
    return { key };
  },
  usage_counter: async (tx, { workspaceId }) => {
    // Usage keys are lowercase dotted segments (usage_*_key_chk): no hyphens, so strip the UUID's.
    const key = `xt.seed.${randomUUID().replaceAll('-', '')}`;
    await tx.insert(usageCounter).values({ workspaceId, key, periodStart: new Date(), value: 1 });
    return { key };
  },
  billing_event: async (tx, { workspaceId }) => {
    const providerEventId = `xt_evt_${randomUUID()}`;
    await tx
      .insert(billingEvent)
      .values({ providerEventId, workspaceId, type: 'xt.seed', payloadHash: randomUUID() });
    return { providerEventId };
  },
  audit_event: async (tx, { workspaceId, ownerId }) => {
    const rows = await tx.execute<{ id: string }>(
      sql`select id from app_audit_append(${workspaceId}::uuid, ${ownerId}::uuid, 'user', 'xt.seed')`,
    );
    return { auditEventId: first([...rows], 'audit_event').id };
  },
  ai_call: async (tx, { workspaceId, ownerId }) => {
    const rows = await tx
      .insert(aiCall)
      .values({
        workspaceId,
        userId: ownerId,
        purpose: 'xt.seed',
        provider: 'mock',
        model: 'mock-1',
        region: 'ap-south-1',
        automationLevel: 1,
      })
      .returning({ id: aiCall.id });
    return { aiCallId: first(rows, 'ai_call').id };
  },
  ai_call_result: async (tx, { workspaceId }) => {
    const rows = await tx
      .insert(aiCallResult)
      .values({
        workspaceId,
        idempotencyKey: `xt-${randomUUID()}`,
        aiCallId: randomUUID(),
        output: {},
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning({ id: aiCallResult.id });
    return { aiCallResultId: first(rows, 'ai_call_result').id };
  },
  notification: async (tx, { workspaceId, ownerId }) => {
    const rows = await tx
      .insert(notification)
      .values({ workspaceId, userId: ownerId, category: 'system.notice', title: 'Seed notice' })
      .returning({ id: notification.id });
    return { notificationId: first(rows, 'notification').id, userId: ownerId };
  },
  notification_pref: async (tx, { workspaceId, ownerId }) => {
    await tx.insert(notificationPref).values({
      workspaceId,
      userId: ownerId,
      category: 'system.notice',
      channel: 'email',
      enabled: false,
    });
    return { userId: ownerId, category: 'system.notice', channel: 'email' };
  },
  notification_setting: async (tx, { workspaceId, ownerId }) => {
    await tx
      .insert(notificationSetting)
      .values({ workspaceId, userId: ownerId, courtHoursQuiet: true });
    return { userId: ownerId };
  },
  usage_reservation: async (tx, { workspaceId }) => {
    const rows = await tx
      .insert(usageReservation)
      .values({
        workspaceId,
        amountPaise: 100,
        purpose: 'xt.seed',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      })
      .returning({ id: usageReservation.id });
    return { reservationId: first(rows, 'usage_reservation').id };
  },
  usage_event: async (tx, { workspaceId }) => {
    const rows = await tx
      .insert(usageEvent)
      .values({
        workspaceId,
        key: 'xt.seed',
        amount: 1,
        idempotencyKey: randomUUID(),
        metadata: { seed_id: randomUUID() },
      })
      .returning({ id: usageEvent.id });
    return { usageEventId: first(rows, 'usage_event').id };
  },
  budget_override: async (tx, { workspaceId, ownerId }) => {
    const rows = await tx
      .insert(budgetOverride)
      .values({
        workspaceId,
        key: 'xt.seed',
        limitValue: 1000,
        setBy: ownerId,
        reason: 'cross-tenant seed',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .returning({ id: budgetOverride.id });
    return { budgetOverrideId: first(rows, 'budget_override').id };
  },
  usage_period_summary: async (tx, { workspaceId }) => {
    const key = `xt.seed_${randomUUID().replaceAll('-', '')}`;
    await tx
      .insert(usagePeriodSummary)
      .values({ workspaceId, key, periodStart: new Date(), value: 1 });
    return { key };
  },
  workspace_feature_flag: async (tx, { workspaceId, ownerId }) => {
    const key = `xt.seed.${randomUUID()}`;
    await tx
      .insert(workspaceFeatureFlag)
      .values({ workspaceId, key, enabled: true, updatedBy: ownerId });
    return { key };
  },
  matter_restriction: async (tx, { workspaceId, ownerId, tag }) => {
    const matterId = await seedMatter(tx, workspaceId, tag);
    const row = first(
      await tx
        .insert(matterRestriction)
        .values({
          workspaceId,
          matterId,
          allowedUserIds: [ownerId],
          createdBy: ownerId,
        })
        .returning({ id: matterRestriction.id, matterId: matterRestriction.matterId }),
      'matter_restriction',
    );
    return { id: row.id, matterId: row.matterId };
  },
  support_session: async (tx, { workspaceId, ownerId }) => {
    // A pending request; the requester's staff_user row is not needed at the SQL level.
    const row = first(
      await tx
        .insert(supportSession)
        .values({ workspaceId, requestedByStaff: ownerId, reason: 'Seed support request' })
        .returning({ id: supportSession.id }),
      'support_session',
    );
    return { id: row.id };
  },
  workspace_integration: async (tx, { workspaceId }) => {
    // The hash of a random token: the plaintext is never stored.
    const tokenHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    const row = first(
      await tx
        .insert(workspaceIntegration)
        .values({ workspaceId, kind: 'ics_feed', tokenHash })
        .returning({ id: workspaceIntegration.id }),
      'workspace_integration',
    );
    return { id: row.id };
  },
  workspace_key: async (tx, { workspaceId }) => {
    // Opaque bytes standing in for a wrapped DEK; the table never sees a plaintext key.
    await tx
      .insert(workspaceKey)
      .values({ workspaceId, wrappedDek: randomBytes(60), kekId: 'kek-test' });
    return { workspaceId };
  },
  blob: async (tx, { workspaceId, ownerId }) => {
    // A finalized upload row; the object itself never exists in a SQL-only suite.
    const id = randomUUID();
    const year = new Date().getUTCFullYear();
    await tx.insert(blob).values({
      id,
      workspaceId,
      key: `ws/${workspaceId}/document/${String(year)}/${id}`,
      kind: 'document',
      filename: 'seed.pdf',
      size: 8,
      sha256: createHash('sha256').update(id).digest('hex'),
      mime: 'application/pdf',
      scanStatus: 'pending',
      createdBy: ownerId,
      finalizedAt: new Date(),
    });
    return { id };
  },
  saas_invoice: async (tx, { workspaceId }) => ({
    invoiceId: await seedDraftInvoice(tx, workspaceId),
  }),
  saas_invoice_line: async (tx, { workspaceId }) => {
    const invoiceId = await seedDraftInvoice(tx, workspaceId);
    const rows = await tx
      .insert(saasInvoiceLine)
      .values({
        workspaceId,
        invoiceId,
        description: 'Seed seat',
        quantity: 1,
        unitPricePaise: 100,
        amountPaise: 100,
      })
      .returning({ id: saasInvoiceLine.id });
    return { invoiceId, lineId: first(rows, 'saas_invoice_line').id };
  },
  export_job: async (tx, { workspaceId, ownerId }) => {
    const row = first(
      await tx
        .insert(exportJob)
        .values({ workspaceId, requestedBy: ownerId, scope: 'workspace', status: 'failed' })
        .returning({ id: exportJob.id }),
      'export_job',
    );
    return { id: row.id };
  },
  forum: async (tx, { workspaceId, tag }) => ({ forumId: await seedForum(tx, workspaceId, tag) }),
  court_hall: async (tx, { workspaceId, tag }) => {
    const forumId = await seedForum(tx, workspaceId, tag);
    const rows = await tx
      .insert(courtHall)
      .values({ workspaceId, forumId, hallNo: '12A', label: 'Court Hall 12A' })
      .returning({ id: courtHall.id });
    return { forumId, hallId: first(rows, 'court_hall').id };
  },
  bench: async (tx, { workspaceId, tag }) => {
    const forumId = await seedForum(tx, workspaceId, tag);
    const rows = await tx
      .insert(bench)
      .values({ workspaceId, forumId, judges: ['Judge A'], benchKind: 'single' })
      .returning({ id: bench.id });
    return { forumId, benchId: first(rows, 'bench').id };
  },
  bench_roster: async (tx, { workspaceId, tag }) => {
    const { forumId, rosterId } = await seedBenchRoster(tx, workspaceId, tag);
    return { forumId, rosterId };
  },
  bench_roster_entry: async (tx, { workspaceId, tag }) => {
    const { forumId, rosterId, benchId } = await seedBenchRoster(tx, workspaceId, tag);
    const halls = await tx
      .insert(courtHall)
      .values({ workspaceId, forumId, hallNo: '12A' })
      .returning({ id: courtHall.id });
    const rows = await tx
      .insert(benchRosterEntry)
      .values({
        workspaceId,
        rosterId,
        hallId: first(halls, 'court_hall').id,
        hallNo: '12A',
        benchId,
        portfolioText: 'Writ petitions',
        portfolioRule: { caseTypes: ['WP'] },
      })
      .returning({ id: benchRosterEntry.id });
    return { rosterId, entryId: first(rows, 'bench_roster_entry').id };
  },
  bench_change_alert: async (tx, { workspaceId, tag }) => {
    const proceedingId = await seedProceeding(tx, workspaceId, tag);
    const { rosterId, benchId } = await seedBenchRoster(tx, workspaceId, tag);
    const rows = await tx
      .insert(benchChangeAlert)
      .values({ workspaceId, proceedingId, rosterId, newBenchId: benchId, reason: 'hall' })
      .returning({ id: benchChangeAlert.id });
    return { proceedingId, rosterId, alertId: first(rows, 'bench_change_alert').id };
  },
  matter: async (tx, { workspaceId, tag }) => ({
    matterId: await seedMatter(tx, workspaceId, tag),
  }),
  document: async (tx, { workspaceId, tag }) => ({
    documentId: await seedDocument(tx, workspaceId, tag),
  }),
  adapter_parse_run: async (tx, { workspaceId, tag }) => {
    const documentId = await seedDocument(tx, workspaceId, tag);
    const rows = await tx
      .insert(adapterParseRun)
      .values({
        workspaceId,
        documentId,
        adapterId: 'echo',
        adapterVersion: '1.0.0',
        forumCode: 'test.echo.principal',
        rowsParsed: 3,
        rowsAnchored: 3,
        unmappedHeadings: 0,
        unknownCaseTypes: 0,
        hallsSeen: ['1'],
        status: 'ok',
      })
      .returning({ id: adapterParseRun.id });
    return { documentId, parseRunId: first(rows, 'adapter_parse_run').id };
  },
  document_page: async (tx, { workspaceId, tag }) => {
    const documentId = await seedDocument(tx, workspaceId, tag);
    const rows = await tx
      .insert(documentPage)
      .values({ workspaceId, documentId, pageNo: 1, text: 'Seed page', textSource: 'layer' })
      .returning({ id: documentPage.id });
    return { documentId, pageId: first(rows, 'document_page').id };
  },
  anchor: async (tx, { workspaceId, tag }) => {
    const documentId = await seedDocument(tx, workspaceId, tag);
    const rows = await tx
      .insert(anchor)
      .values({ workspaceId, documentId, pageNo: 1, quote: 'Seed quote', kind: 'document' })
      .returning({ id: anchor.id });
    return { documentId, anchorId: first(rows, 'anchor').id };
  },
  proceeding: async (tx, { workspaceId, tag }) => ({
    proceedingId: await seedProceeding(tx, workspaceId, tag),
  }),
  proceeding_link: async (tx, { workspaceId, tag }) => {
    const parentId = await seedProceeding(tx, workspaceId, `${tag}-main`);
    const childId = await seedProceeding(tx, workspaceId, `${tag}-misc`);
    const rows = await tx
      .insert(proceedingLink)
      .values({
        workspaceId,
        fromProceedingId: parentId,
        toProceedingId: childId,
        kind: 'parent_of',
        sourceType: 'manual',
      })
      .returning({ id: proceedingLink.id });
    return { parentId, childId, linkId: first(rows, 'proceeding_link').id };
  },
  proceeding_state_change: async (tx, { workspaceId, tag }) => {
    const proceedingId = await seedProceeding(tx, workspaceId, tag);
    const rows = await tx
      .insert(proceedingStateChange)
      .values({
        workspaceId,
        proceedingId,
        fromState: 'filed',
        toState: 'sr_fr',
        sourceType: 'manual',
        confirmationState: 'confirmed',
      })
      .returning({ id: proceedingStateChange.id });
    return { proceedingId, stateChangeId: first(rows, 'proceeding_state_change').id };
  },
  listing: async (tx, { workspaceId, tag }) => ({
    listingId: await seedListing(tx, workspaceId, tag),
  }),
  hearing: async (tx, { workspaceId, tag }) => ({
    hearingId: await seedHearing(tx, workspaceId, tag),
  }),
  appearance: async (tx, { workspaceId, tag }) => {
    const hearingId = await seedHearing(tx, workspaceId, tag);
    const rows = await tx
      .insert(appearance)
      .values({ workspaceId, hearingId, capacity: 'arguing' })
      .returning({ id: appearance.id });
    return { hearingId, appearanceId: first(rows, 'appearance').id };
  },
  order: async (tx, { workspaceId, tag }) => {
    const proceedingId = await seedProceeding(tx, workspaceId, tag);
    const documentId = await seedDocument(tx, workspaceId, tag);
    const rows = await tx
      .insert(order)
      .values({
        workspaceId,
        proceedingId,
        documentId,
        orderDate: '2026-11-02',
        orderType: 'procedural',
        sourceType: 'manual',
      })
      .returning({ id: order.id });
    return { proceedingId, documentId, orderId: first(rows, 'order').id };
  },
  obligation: async (tx, { workspaceId, tag }) => ({
    obligationId: await seedObligation(tx, workspaceId, tag),
  }),
  task: async (tx, { workspaceId, tag }) => {
    const obligationId = await seedObligation(tx, workspaceId, tag);
    const rows = await tx
      .insert(task)
      .values({
        workspaceId,
        title: 'Draft the counter affidavit',
        fulfilsObligationId: obligationId,
        sourceType: 'manual',
      })
      .returning({ id: task.id });
    return { obligationId, taskId: first(rows, 'task').id };
  },
  person: async (tx, { workspaceId, tag }) => ({
    personId: await seedPerson(tx, workspaceId, tag),
  }),
  organisation: async (tx, { workspaceId, tag }) => {
    const rows = await tx
      .insert(organisation)
      .values({ workspaceId, name: `Firm ${tag}` })
      .returning({ id: organisation.id });
    return { organisationId: first(rows, 'organisation').id };
  },
  role_edge: async (tx, { workspaceId, tag }) => {
    const advocateId = await seedPerson(tx, workspaceId, `${tag}-advocate`);
    const partyId = await seedPerson(tx, workspaceId, `${tag}-party`);
    const rows = await tx
      .insert(roleEdge)
      .values({
        workspaceId,
        kind: 'represents',
        fromPersonId: advocateId,
        toPersonId: partyId,
        sourceType: 'manual',
      })
      .returning({ id: roleEdge.id });
    return { advocateId, partyId, roleEdgeId: first(rows, 'role_edge').id };
  },
  deletion_job: async (tx, { workspaceId, ownerId }) => {
    const row = first(
      await tx
        .insert(deletionJob)
        .values({ workspaceId, kind: 'workspace', requestedBy: ownerId, status: 'cancelled' })
        .returning({ id: deletionJob.id }),
      'deletion_job',
    );
    return { id: row.id };
  },
};

/** Registered tenant tables with no seeder (the registry test expects none). */
export function unseededTenantTables(): string[] {
  return seededTables().filter((table) => !(table in TENANT_SEEDERS));
}

export interface TenantFixture {
  id: string;
  slug: string;
  name: string;
  /** Seed row per tenant table, by table name. */
  rows: Record<string, SeedRow>;
}

export interface TwoTenants {
  a: TenantFixture;
  b: TenantFixture;
  ua: string;
  ub: string;
  uboth: string;
}

export interface TwoTenantsOptions {
  /** Existing user ids (e.g. signed in through Better Auth); new users are created otherwise. */
  users?: { ua: string; ub: string; uboth: string };
}

async function seedWorkspace(
  q: Queryable,
  label: 'a' | 'b',
  ownerId: string,
  uboth: string,
): Promise<TenantFixture> {
  const id = randomUUID();
  const tag = `${label}-${id.slice(0, 8)}`;
  const slug = `xt-${tag}`;
  const name = `Chambers ${label.toUpperCase()} ${id.slice(0, 8)}`;
  const rows: Record<string, SeedRow> = {};
  await withWorkspace(q, { workspaceId: id, userId: ownerId }, async (tx) => {
    await tx.insert(organization).values({ id, name, slug, createdBy: ownerId });
    await tx.insert(member).values([
      { organizationId: id, userId: ownerId, role: 'owner' },
      { organizationId: id, userId: uboth, role: 'advocate' },
    ]);
    for (const table of seededTables()) {
      const seeder = TENANT_SEEDERS[table];
      if (seeder === undefined) throw new Error(`two-tenants: no seeder for tenant table ${table}`);
      rows[table] = await seeder(tx, { workspaceId: id, ownerId, tag });
    }
  });
  return { id, slug, name, rows };
}

/** Seed workspaces A and B, their users and a row in every tenant table of each. */
export async function seedTwoTenants(
  q: Queryable,
  { users }: TwoTenantsOptions = {},
): Promise<TwoTenants> {
  await q
    .insert(plan)
    .values({
      id: TWO_TENANTS_PLAN_ID,
      name: 'Cross-tenant seed',
      kind: 'advocate',
      interval: 'month',
      pricePaise: 0,
    })
    .onConflictDoNothing();
  const ua = users?.ua ?? (await newUser(q, 'ua'));
  const ub = users?.ub ?? (await newUser(q, 'ub'));
  const uboth = users?.uboth ?? (await newUser(q, 'uboth'));
  const a = await seedWorkspace(q, 'a', ua, uboth);
  const b = await seedWorkspace(q, 'b', ub, uboth);
  return { a, b, ua, ub, uboth };
}
