// Writing the demo workspaces (#93): see index.ts for the contract.
import { isProd } from '@causedeck/config/env';
import { eq, inArray } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import type { Transaction } from '../../client.ts';
import { withWorkspace } from '../../rls.ts';
import { member, organization, user } from '../../schema/auth.ts';
import { bench, courtHall, forum } from '../../schema/court.ts';
import { hearing, listing, obligation, order, task, appearance } from '../../schema/docket.ts';
import { anchor, document } from '../../schema/documents.ts';
import { featureFlag, workspaceFeatureFlag } from '../../schema/flags.ts';
import { matter } from '../../schema/matter-graph.ts';
import { person, roleEdge } from '../../schema/people.ts';
import { proceeding, proceedingLink } from '../../schema/proceedings.ts';
import { workspaceSettings } from '../../schema/workspace.ts';
import { briefState } from '../../schema/brief.ts';
import { capture } from '../../schema/capture.ts';
import { clientContact } from '../../schema/client-contact.ts';
import { handoverNote, matterView } from '../../schema/continuity.ts';
import { courtDayMarker, listSnapshot } from '../../schema/court-day.ts';
import { draft, draftVersion, template } from '../../schema/drafting.ts';
import { conflictCheckResult, enquiry, enquiryParty } from '../../schema/enquiry.ts';
import {
  clientLedgerEntry,
  feeAgreement,
  feeInvoice,
  feeInvoiceLine,
  payment,
} from '../../schema/fees.ts';
import { limitationComputation, limitationRule } from '../../schema/limitation.ts';
import { judgmentAlert, matterIssueTag } from '../../schema/matter-issue.ts';
import { noticeMatch } from '../../schema/notices.ts';
import { subscription } from '../../schema/billing.ts';
import { saasInvoice, saasInvoiceLine } from '../../schema/saas-invoice.ts';
import { notification } from '../../schema/notifications.ts';
import { certifiedCopy, defect, obligationEvent } from '../../schema/obligation-tracking.ts';
import { outwardDraft, outwardDraftVersion } from '../../schema/outward-draft.ts';
import { portfolio, portfolioCase } from '../../schema/portfolio.ts';
import { loadPulse, preparednessRating } from '../../schema/proof-of-value.ts';
import { activity, proposal } from '../../schema/automation.ts';
import { researchNote } from '../../schema/research-note.ts';
import { statusLink } from '../../schema/status-link.ts';
import type { SeedDb } from '../index.ts';

import {
  existingJudgmentIds,
  existingPlanIds,
  existingNoticeIds,
  refreshDemoCatalogue,
  seedDemoCatalogue,
} from './catalogue.ts';
import { demoCourtRows } from './courts.ts';
import { demoMatterRows } from './matters.ts';
import { demoModuleRows, type DemoModuleRows } from './modules.ts';
import { DEMO_VERSION } from './meta.ts';
import { demoMember, demoOrganization, demoUsers } from './people.ts';
import { kolkataToday, seedInstant } from './shared.ts';
import { DEMO_WORKSPACE_KEYS, demoWorkspace, type DemoWorkspaceKey } from './workspaces.ts';

/** Each non-empty batch is one statement; parents come before children. */
async function insertModules(
  tx: Transaction,
  m: DemoModuleRows,
  present: {
    judgments: ReadonlySet<string>;
    notices: ReadonlySet<string>;
    plans: ReadonlySet<string>;
  },
): Promise<void> {
  const put = async <T extends PgTable>(table: T, values: T['$inferInsert'][]) => {
    if (values.length > 0) await tx.insert(table).values(values).onConflictDoNothing();
  };
  await put(roleEdge, m.roleEdges);
  await put(clientContact, m.contacts);
  await put(enquiry, m.enquiries);
  await put(enquiryParty, m.enquiryParties);
  await put(conflictCheckResult, m.conflictResults);
  await put(listSnapshot, m.snapshots);
  await put(courtDayMarker, m.markers);
  await put(briefState, m.briefStates);
  await put(document, m.documents);
  await put(anchor, m.anchors);
  await put(order, m.orders);
  await put(obligation, m.obligations);
  await put(handoverNote, m.handovers);
  await put(matterView, m.matterViews);
  await put(appearance, m.appearances);
  await put(preparednessRating, m.ratings);
  await put(loadPulse, m.pulses);
  await put(feeAgreement, m.agreements);
  await put(feeInvoice, m.invoices);
  await put(feeInvoiceLine, m.invoiceLines);
  await put(payment, m.payments);
  await put(clientLedgerEntry, m.ledger);
  await put(limitationRule, m.limitationRules);
  await put(limitationComputation, m.limitationComputations);
  await put(statusLink, m.statusLinks);
  await put(outwardDraft, m.outwardDrafts);
  await put(outwardDraftVersion, m.outwardVersions);
  await put(template, m.templates);
  await put(draft, m.drafts);
  await put(draftVersion, m.draftVersions);
  await put(capture, m.captures);
  await put(proposal, m.proposals);
  await put(activity, m.activities);
  await put(notification, m.notifications);
  await put(matterIssueTag, m.issueTags);
  // The corpus and the notices are global rows the owner-role command writes; a reset on a database
  // that never had them just leaves the dependants out (the foreign keys would refuse them).
  await put(
    judgmentAlert,
    m.judgmentAlerts.filter((a) => present.judgments.has(a.judgmentId)),
  );
  await put(
    noticeMatch,
    m.noticeMatches.filter((n) => present.notices.has(n.noticeId)),
  );
  await put(researchNote, m.researchNotes);
  await put(defect, m.defects);
  await put(certifiedCopy, m.certifiedCopies);
  await put(obligationEvent, m.obligationEvents);
  await put(portfolio, m.portfolios);
  await put(portfolioCase, m.portfolioCases);
  // Without the plan catalogue (never seeded here) there is no subscription, and so no invoice either.
  const subscribed = m.billing.subscriptions.filter((s) => present.plans.has(s.planId));
  await put(subscription, subscribed);
  if (subscribed.length > 0) await insertSaasInvoices(tx, m);
}

/**
 * The SaaS invoices (#1071). An issued invoice is immutable and its lines cannot be added once it is
 * (trigger `saas_invoice_line_immutable`, which fires before the conflict check), so each new invoice
 * is written as a draft, given its lines and then moved to its final status; one that exists is left
 * alone, which keeps a second run and a reset (when the role may not delete invoices) a no-op.
 */
async function insertSaasInvoices(tx: Transaction, m: DemoModuleRows): Promise<void> {
  const ids = m.billing.invoices.map((i) => i.id as string);
  if (ids.length === 0) return;
  const existing = new Set(
    (
      await tx.select({ id: saasInvoice.id }).from(saasInvoice).where(inArray(saasInvoice.id, ids))
    ).map((r) => r.id),
  );
  for (const invoice of m.billing.invoices) {
    if (existing.has(invoice.id as string)) continue;
    await tx.insert(saasInvoice).values({ ...invoice, status: 'draft' });
    await tx
      .insert(saasInvoiceLine)
      .values(m.billing.invoiceLines.filter((l) => l.invoiceId === invoice.id));
    await tx
      .update(saasInvoice)
      .set({ status: invoice.status })
      .where(eq(saasInvoice.id, invoice.id as string));
  }
}

export interface SeedDemoOptions {
  /** The seed day (`yyyy-mm-dd`); defaults to today in Asia/Kolkata. Tests pin it. */
  today?: string;
  /** Which workspaces; default both. */
  workspaces?: readonly DemoWorkspaceKey[];
}

export class DemoSeedInProductionError extends Error {
  override name = 'DemoSeedInProductionError';
  constructor() {
    super('The demo seed never runs when NODE_ENV=production.');
  }
}

/** Flags the demo workspaces have on (`m5_playbooks`: default off everywhere else, #901). */
export const DEMO_FLAG_OVERRIDES = ['m5_playbooks', 'insights.enabled'] as const;

/**
 * Legal-gated flags (counsel sign-off) the demo modules need: fees and invoices, limitation, the
 * conflict check, the enquiry log, client status links and bench facts. A workspace row never turns
 * a legal flag on by itself (it needs the global row with an acknowledgement), so they stay off
 * unless `enableDemoGatedFlags` runs (`pnpm db:seed:demo -- --enable-gated-flags`, never in
 * production). It writes the global row too, so it is for a local or review database only.
 */
export const DEMO_GATED_FLAGS = [
  'invoices.enabled',
  'limitation.enabled',
  'conflicts.check',
  'intake.enquiry_log',
  'status_links.enabled',
  'bench_facts',
] as const;

export const DEMO_GATED_FLAG_NOTE =
  'Demo environment only: not a counsel sign-off. Set by pnpm db:seed:demo --enable-gated-flags.';

/** Turn the gated flags on for the demo workspaces and globally (acknowledged by the demo advocate). */
export async function enableDemoGatedFlags(
  db: SeedDb,
  workspaces: readonly DemoWorkspaceKey[] = DEMO_WORKSPACE_KEYS,
): Promise<void> {
  if (isProd()) throw new DemoSeedInProductionError();
  const at = new Date();
  const first = demoWorkspace(workspaces[0] ?? 'chennai-solo');
  const ack = demoMember(first, 'advocate').id;
  await db
    .insert(featureFlag)
    .values(
      DEMO_GATED_FLAGS.map((key) => ({
        key,
        enabled: true,
        updatedBy: ack,
        legalAckBy: ack,
        legalAckNote: DEMO_GATED_FLAG_NOTE,
        updatedAt: at,
      })),
    )
    .onConflictDoNothing();
  for (const key of workspaces) {
    const ws = demoWorkspace(key);
    await withWorkspace(db, { workspaceId: ws.id }, async (tx) => {
      await tx
        .insert(workspaceFeatureFlag)
        .values(
          DEMO_GATED_FLAGS.map((flag) => ({
            workspaceId: ws.id,
            key: flag,
            enabled: true,
            legalAckBy: ack,
            legalAckNote: DEMO_GATED_FLAG_NOTE,
            updatedAt: at,
          })),
        )
        .onConflictDoNothing();
    });
  }
}

function checkDay(today: string | undefined): string {
  const day = today ?? kolkataToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new TypeError(`seedDemo: bad day ${day}`);
  return day;
}

/**
 * Write one demo workspace for the seed day `today`: a no-op for rows that exist. It does not look
 * at `NODE_ENV`: the nightly reset restores demo workspaces that already exist in any environment,
 * while `seedDemo` (the command) is the one that refuses production.
 */
export async function seedDemoWorkspace(
  db: SeedDb,
  key: DemoWorkspaceKey,
  { today }: { today?: string } = {},
): Promise<void> {
  const day = checkDay(today);
  const ws = demoWorkspace(key);
  const at = seedInstant(day);
  const courts = demoCourtRows(ws, at);
  const graph = demoMatterRows(ws, day, at);
  const mod = demoModuleRows(ws, day, at, graph, courts);
  const users = demoUsers(ws);
  // Global rows the workspace's alerts and notice matches point at; the news and notice dates follow the day.
  await refreshDemoCatalogue(db, day);
  const present = {
    judgments: await existingJudgmentIds(
      db,
      mod.judgmentAlerts.map((a) => a.judgmentId),
    ),
    notices: await existingNoticeIds(
      db,
      mod.noticeMatches.map((n) => n.noticeId),
    ),
    plans: await existingPlanIds(
      db,
      mod.billing.subscriptions.map((s) => s.planId),
    ),
  };

  await db
    .insert(user)
    .values(
      users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        emailVerified: true,
        locale: 'en',
        createdAt: at,
        updatedAt: at,
      })),
    )
    .onConflictDoNothing();

  await withWorkspace(db, { workspaceId: ws.id }, async (tx) => {
    await tx
      .insert(organization)
      .values({ ...demoOrganization(ws), createdAt: at })
      .onConflictDoNothing();
    await tx
      .insert(workspaceSettings)
      .values({
        workspaceId: ws.id,
        practiceCity: ws.practiceCity,
        demoVersion: DEMO_VERSION,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing();
    await tx
      .insert(member)
      .values(
        users.map((u) => ({
          id: u.memberId,
          organizationId: ws.id,
          userId: u.id,
          role: u.role,
          joinedAt: at,
          roleGrantedAt: at,
          createdAt: at,
        })),
      )
      .onConflictDoNothing();
    await tx
      .insert(workspaceFeatureFlag)
      .values(
        DEMO_FLAG_OVERRIDES.map((flag) => ({
          workspaceId: ws.id,
          key: flag,
          enabled: true,
          updatedAt: at,
        })),
      )
      .onConflictDoNothing();
    // Parents before children; each batch is a single statement.
    await tx.insert(forum).values(courts.forums).onConflictDoNothing();
    await tx.insert(courtHall).values(courts.halls).onConflictDoNothing();
    await tx.insert(bench).values(courts.benches).onConflictDoNothing();
    await tx.insert(matter).values(graph.matters).onConflictDoNothing();
    await tx.insert(person).values(graph.persons).onConflictDoNothing();
    await tx.insert(roleEdge).values(graph.roleEdges).onConflictDoNothing();
    for (const row of graph.proceedings) {
      // One at a time: children reference parents inserted just before them.
      await tx.insert(proceeding).values(row).onConflictDoNothing();
    }
    if (graph.proceedingLinks.length > 0) {
      await tx.insert(proceedingLink).values(graph.proceedingLinks).onConflictDoNothing();
    }
    await tx.insert(document).values(graph.documents).onConflictDoNothing();
    await tx.insert(anchor).values(graph.anchors).onConflictDoNothing();
    await tx.insert(order).values(graph.orders).onConflictDoNothing();
    await tx.insert(listing).values(graph.listings).onConflictDoNothing();
    await tx.insert(hearing).values(graph.hearings).onConflictDoNothing();
    await tx.insert(obligation).values(graph.obligations).onConflictDoNothing();
    await tx.insert(task).values(graph.tasks).onConflictDoNothing();
    await insertModules(tx, mod, present);
  });
}

/** Seed the demo workspaces (both by default). A second run is a no-op. */
export async function seedDemo(db: SeedDb, options: SeedDemoOptions = {}): Promise<void> {
  if (isProd()) throw new DemoSeedInProductionError();
  const day = checkDay(options.today);
  // The corpus, news and notices are global: written once, before any workspace points at them.
  await seedDemoCatalogue(db, day);
  for (const key of options.workspaces ?? DEMO_WORKSPACE_KEYS) {
    await seedDemoWorkspace(db, key, { today: day });
  }
}
