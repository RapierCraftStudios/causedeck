// Workspace erase (#302, part 2 of #31; docs/engineering/data-lifecycle.md). Runs as the
// `deletion.erase` job once the 14-day cool-off has ended, in this order:
//   1. revoke   mark `organization.deleted_at`, delete the workspace's sessions and its
//               integration tokens (`workspace_integration`: the ICS feed, the
//               workspace's API tokens), cancel pending invitations and end support sessions.
//   2. dek      `destroyWorkspaceKey`: without the DEK no stored ciphertext can be decrypted.
//   3. blobs    delete every object under the workspace's storage prefix (`ws/<id>/`).
//   4. rows     copy the tax invoices to `legal_hold_invoice`, then purge the tenant tables in
//               `PURGE_ORDER` in batches (children before parents), plus `api_idempotency_key`.
//   5. receipt  capture the audit chain head, build and sign the receipt, email it to the requester,
//               then `app_finalize_workspace_deletion` (0032) writes the tombstone, purges
//               `audit_event`, `ai_call` and `usage_period_summary` and deletes the organization row
//               (cascading `deletion_job` and the destroyed `workspace_key`) in one transaction.
// Each step checkpoints `{startedAt, doneAt, ...counts}` in `deletion_job.steps` through the root
// client in its own `withWorkspace` transaction, so a crash or retry resumes after the last finished
// step (and mid-table in step 4). Every step is idempotent. Logs carry ids and counts only.
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import {
  emailErrorCode,
  isPermanentEmailError,
  isSuppressed,
  renderEmail,
  type EmailTransport,
} from '@causedeck/notifications/email';
import type { Logger } from '@causedeck/observability';
import { destroyWorkspaceKey, type ObjectStore } from '@causedeck/storage';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { record } from '../../audit/index.ts';
import { withdrawContributions } from '../../network/index.ts';

import { retainInvoicesForLegalHold } from './legal-hold.ts';
import { buildDeletionReceipt, receiptHash, type DeletionReceipt } from './receipt.ts';

const {
  apiIdempotencyKey,
  deletionJob,
  deletionTombstone,
  invitation,
  organization,
  session,
  supportSession,
  user,
  workspaceIntegration,
} = schema;

/**
 * Tenant tables purged in step 4, in this order (children before parents: `saas_invoice_line`
 * before `saas_invoice`). Every tenant table is either here or in `FINALIZE_TABLES`; the purge
 * coverage test checks both against the cross-tenant registry, so a new tenant table cannot escape
 * erasure.
 */
export const PURGE_ORDER = [
  'notification',
  'notification_pref',
  'notification_setting',
  // News digest (#481): the member's followed areas and digest time (news_item is global).
  'news_pref',
  'invitation',
  'support_session',
  // Court document network (#485): the link to a shared public copy; the rows step withdraws first.
  'contribution_ledger',
  // Official notices feed (#584): matches cite a matter or forum; before both.
  'notice_match',
  // Change webhooks (#626): deliveries before the endpoint they cite; both cite only the workspace
  // and the creating user, so they go before the workspace and the members.
  'webhook_delivery',
  'webhook_endpoint',
  // Institution portfolios (#661): cases and panel advocates before their portfolio; the portfolio
  // cites only the workspace and its creating user, and cases cite proceedings, so before both.
  'portfolio_case',
  'portfolio_panel_advocate',
  'portfolio',
  // The matter graph (#345-#348): appearances before their hearing, hearings before their
  // listing; tasks before the obligations they fulfil, obligations before their source order;
  // listings, orders and obligations before the proceedings, documents, anchors and matters they
  // cite; role edges before the persons, proceedings and matters they join, persons before the
  // anchors they cite; state history (#363) and links before their proceedings, proceedings
  // before the anchors, matters and forums they cite; parse-health runs (#372), anchors and pages
  // before their document, documents and restrictions before their matter, matters (and the
  // docket) before the members their member columns name. Bench rosters (#384): alerts before
  // the rosters and proceedings they cite, entries before their roster, rosters before the
  // documents, members and court rows they cite.
  // The automation engine (#47): activities before the proposals they cite; neither cites the graph.
  'activity',
  'proposal',
  'automation_preference',
  'automation_threshold',
  'appearance',
  'hearing',
  'task',
  'obligation',
  'order',
  'listing',
  'bench_change_alert',
  'bench_roster_entry',
  'bench_roster',
  'role_edge',
  'person',
  'organisation',
  // Case-status watch (#589): snapshots before their watch, the watch before its proceeding.
  'case_status_snapshot',
  'case_watch',
  'review_correction',
  'proceeding_state_change',
  'proceeding_link',
  'proceeding',
  'adapter_parse_run',
  // Anchored order extractions (#46) cite their document; before it.
  'extraction',
  'anchor',
  'document_page',
  'document',
  // Calendar interop (#53): the import ledger cites captures, so it goes before them; feed events
  // before their feed.
  'ics_import_event',
  'ics_feed_event',
  'ics_feed',
  // Bootstrap import (#546): plan and files before their batch, all before the captures they cite.
  'import_plan',
  'import_batch_file',
  'import_batch',
  // The importing member's identifiers (#550): cites no capture, only the user.
  'advocate_profile',
  // Court watches (#482): cite the member's user and the organization only.
  'cause_list_watch',
  // The capture inbox (#43): after the documents that cite a capture, before the matters it hints.
  'capture',
  'workspace_capture_channel',
  'matter_restriction',
  // Judgment alerts (#497): alerts before the tag they cite, both before their matter.
  'judgment_alert',
  'matter_issue_tag',
  'matter',
  // Custom court reference rows (#344): halls and benches before their forum; the catalogue
  // (null workspace_id) is never matched.
  'court_hall',
  'bench',
  'forum',
  'export_job',
  'blob',
  'saas_invoice_line',
  'saas_invoice',
  'usage_reservation',
  'usage_event',
  'budget_override',
  'usage_counter',
  'billing_event',
  'entitlement',
  'subscription',
  'workspace_feature_flag',
  'workspace_integration',
  'api_key',
  // Email intake (#54): the ledger, then the allow-list and the members' addresses.
  'intake_message',
  'intake_allowlist',
  'intake_address',
  'workspace_slug_history',
  'workspace_settings',
  // AI gateway retry cache (#44): holds model output, unlike the append-only ai_call it points at.
  'ai_call_result',
  'job_effect',
  'member',
] as const;

/** Tenant tables removed by `app_finalize_workspace_deletion` in step 5, with the reason. */
export const FINALIZE_TABLES: Readonly<Record<string, string>> = {
  audit_event: 'append-only for the app role; purged after the chain head is in the receipt',
  ai_call: 'append-only for the app role, like audit_event',
  usage_period_summary: 'closed periods may only be deleted by the owner role',
  workspace_key: 'the destroyed key row; finalize checks it before erasing, then it cascades',
  deletion_job: 'the job driving the erase; cascades with the organization row',
  organization: 'the tenant root, deleted last',
};

/** Rows deleted per transaction in step 4. */
export const PURGE_BATCH = 500;

export interface PurgeCoverage {
  /** Tenant tables neither purged nor finalized. */
  uncovered: string[];
  /** Tables listed in both. */
  conflicting: string[];
  /** Listed tables that are not tenant tables (any more). */
  stale: string[];
}

/** Compare `PURGE_ORDER` and `FINALIZE_TABLES` with the tenant tables. */
export function purgeCoverage(tenantTables: readonly string[]): PurgeCoverage {
  const purged = new Set<string>(PURGE_ORDER);
  const finalized = new Set(Object.keys(FINALIZE_TABLES));
  const tenant = new Set(tenantTables);
  return {
    uncovered: tenantTables.filter((t) => !purged.has(t) && !finalized.has(t)).sort(),
    conflicting: [...purged].filter((t) => finalized.has(t)).sort(),
    stale: [...purged, ...finalized].filter((t) => !tenant.has(t)).sort(),
  };
}

export const ERASE_STEPS = ['revoke', 'dek', 'blobs', 'rows', 'receipt'] as const;
export type EraseStep = (typeof ERASE_STEPS)[number];

interface StepState {
  startedAt?: string;
  doneAt?: string;
  [extra: string]: unknown;
}

type Steps = Partial<Record<EraseStep, StepState>> & Record<string, unknown>;

export type EraseOutcome = 'erased' | 'already_erased' | 'missing' | 'cancelled' | 'too_early';

export interface EraseDeps {
  store: ObjectStore;
  email: EmailTransport;
  /** The server secret the receipt signature key is derived from (`BETTER_AUTH_SECRET`). */
  secret: string;
  appUrl: string;
  now?: () => Date;
  /** Test hook: called after each step, purge batch and email; throwing simulates a dying worker. */
  crashAfter?: (point: string) => void;
}

export interface EraseCtx {
  /** The root client: every write opens its own `withWorkspace` transaction. */
  db: Queryable;
  log: Pick<Logger, 'info' | 'warn'>;
}

async function tombstoned(db: Queryable, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ workspaceId: deletionTombstone.workspaceId })
    .from(deletionTombstone)
    .where(eq(deletionTombstone.workspaceId, workspaceId));
  return row !== undefined;
}

/** Erase one workspace whose cool-off has ended. Resumable and idempotent. */
export async function runWorkspaceErase(
  ctx: EraseCtx,
  { workspaceId, jobId }: { workspaceId: string; jobId: string },
  deps: EraseDeps,
): Promise<EraseOutcome> {
  const now = deps.now ?? (() => new Date());
  const iso = () => now().toISOString();
  const fields = { workspaceId, jobId };
  const done = (outcome: EraseOutcome) => {
    ctx.log.info({ ...fields, outcome }, 'workspace erase');
    return outcome;
  };
  if (await tombstoned(ctx.db, workspaceId)) return done('already_erased');

  const scope = { workspaceId };
  const job = await withWorkspace(ctx.db, scope, async (tx) => {
    const [row] = await tx
      .select()
      .from(deletionJob)
      .where(
        and(
          eq(deletionJob.id, jobId),
          eq(deletionJob.workspaceId, workspaceId),
          eq(deletionJob.kind, 'workspace'),
        ),
      )
      .for('update');
    if (row === undefined) return null;
    if (row.status === 'cancelled' || row.status === 'erased') return row;
    if (row.cooloffUntil === null || row.cooloffUntil > now()) return row;
    if (row.status !== 'running') {
      const first = row.steps.startedAt === undefined;
      const steps = first ? { ...row.steps, startedAt: iso() } : row.steps;
      await tx
        .update(deletionJob)
        .set({ status: 'running', steps })
        .where(eq(deletionJob.id, jobId));
      if (first) {
        await record(
          { db: tx, workspaceId, actor: { userId: null, kind: 'system' } },
          {
            action: 'workspace.deletion_started',
            target: { kind: 'deletion_job', id: jobId },
            metadata: { jobId },
          },
        );
      }
      return { ...row, status: 'running' as const, steps };
    }
    return row;
  });
  if (job === null) return done('missing');
  if (job.status === 'cancelled') return done('cancelled');
  if (job.status === 'erased') return done('already_erased');
  if (job.cooloffUntil === null || job.cooloffUntil > now()) return done('too_early');

  const steps: Steps = { ...(job.steps as Steps) };
  const save = (name: EraseStep, state: StepState) => {
    steps[name] = state;
    return withWorkspace(ctx.db, scope, (tx) =>
      tx
        .update(deletionJob)
        .set({ steps: sql`${deletionJob.steps} || ${JSON.stringify({ [name]: state })}::jsonb` })
        .where(eq(deletionJob.id, jobId)),
    );
  };
  const crash = (point: string) => deps.crashAfter?.(point);

  async function step(
    name: EraseStep,
    run: (state: StepState) => Promise<Record<string, unknown>>,
  ): Promise<void> {
    const prior = steps[name];
    if (prior?.doneAt !== undefined) return;
    const state: StepState = { ...prior, startedAt: prior?.startedAt ?? iso() };
    if (prior?.startedAt === undefined) await save(name, state);
    const extra = await run(state);
    await save(name, { ...state, ...extra, doneAt: iso() });
    ctx.log.info({ ...fields, step: name }, 'workspace erase step done');
    crash(name);
  }

  // 1. Revoke access.
  await step('revoke', () =>
    withWorkspace(ctx.db, scope, async (tx) => {
      await tx
        .update(organization)
        .set({ deletedAt: sql`coalesce(${organization.deletedAt}, ${iso()}::timestamptz)` })
        .where(eq(organization.id, workspaceId));
      const sessions = await tx
        .delete(session)
        .where(eq(session.activeOrganizationId, workspaceId))
        .returning({ id: session.id });
      const invitations = await tx
        .update(invitation)
        .set({ status: 'canceled', revokedAt: now() })
        .where(and(eq(invitation.organizationId, workspaceId), eq(invitation.status, 'pending')))
        .returning({ id: invitation.id });
      // Integration tokens stop resolving at once (only their hashes are stored). Any future
      // workspace-scoped API token or key table is revoked here too, before the DEK is destroyed.
      const tokens = await tx
        .delete(workspaceIntegration)
        .where(eq(workspaceIntegration.workspaceId, workspaceId))
        .returning({ id: workspaceIntegration.id });
      const support = await tx
        .update(supportSession)
        .set({ status: 'ended', endedAt: now() })
        .where(
          and(
            eq(supportSession.workspaceId, workspaceId),
            inArray(supportSession.status, ['requested', 'granted']),
          ),
        )
        .returning({ id: supportSession.id });
      return {
        sessions: sessions.length,
        invitations: invitations.length,
        supportSessions: support.length,
        tokens: tokens.length,
      };
    }),
  );

  // 2. Destroy the data-encryption key.
  await step('dek', async () => {
    await destroyWorkspaceKey(ctx.db, workspaceId);
    return {};
  });

  // 3. Delete every object under the workspace prefix.
  await step('blobs', async (state) => {
    let count = typeof state.count === 'number' ? state.count : 0;
    for (;;) {
      const objects = await deps.store.list(workspaceId);
      if (objects.length === 0) break;
      for (const object of objects) await deps.store.delete(object.key);
      count += objects.length;
      await save('blobs', { ...state, count });
      crash('blobs:page');
    }
    return { count };
  });

  // 4. Keep the tax invoices under legal hold, then purge the tenant rows in batches.
  await step('rows', async (state) => {
    const tables: Record<string, number> = {
      ...((state.tables as Record<string, number> | undefined) ?? {}),
    };
    const legalHoldInvoices =
      typeof state.legalHoldInvoices === 'number'
        ? state.legalHoldInvoices
        : await withWorkspace(ctx.db, scope, (tx) => retainInvoicesForLegalHold(tx, workspaceId));
    await save('rows', { ...state, tables, legalHoldInvoices });
    // Withdraw this workspace's contributed court documents (#485) before its ledger rows go.
    await withdrawContributions(ctx.db, workspaceId);
    for (const table of PURGE_ORDER) {
      for (;;) {
        const name = sql.identifier(table);
        const deleted = await withWorkspace(ctx.db, scope, (tx) =>
          tx.execute(
            sql`delete from ${name} where ctid in (select ctid from ${name} where workspace_id = ${workspaceId}::uuid limit ${PURGE_BATCH})`,
          ),
        );
        const n = deleted.count;
        if (n === 0) break;
        tables[table] = (tables[table] ?? 0) + n;
        await save('rows', { ...state, tables, legalHoldInvoices });
        crash(`rows:${table}`);
        if (n < PURGE_BATCH) break;
      }
    }
    // Global, keyed by user, but holds the workspace's API responses (cascades from organization
    // too; deleted here so the purge does not depend on the cascade).
    const idempotency = await ctx.db
      .delete(apiIdempotencyKey)
      .where(eq(apiIdempotencyKey.workspaceId, workspaceId))
      .returning({ id: apiIdempotencyKey.id });
    if (idempotency.length > 0) tables.api_idempotency_key = idempotency.length;
    return { tables, legalHoldInvoices };
  });

  // 5. Receipt (emailed before the final step), then the tombstone and the final purge.
  const receiptState: StepState = steps.receipt ?? {};
  if (receiptState.startedAt === undefined) {
    receiptState.startedAt = iso();
    await save('receipt', receiptState);
  }
  let receipt = receiptState.receipt as DeletionReceipt | undefined;
  if (receipt === undefined) {
    const head = await withWorkspace(ctx.db, scope, (tx) =>
      tx.execute<{ hash: string }>(
        sql`select encode(hash, 'hex') as hash from audit_event where workspace_id = ${workspaceId}::uuid order by created_at desc, id desc limit 1`,
      ),
    );
    const at = (name: 'revoke' | 'dek' | 'blobs' | 'rows') => ({
      startedAt: String(steps[name]?.startedAt),
      doneAt: String(steps[name]?.doneAt),
    });
    const tables = (steps.rows?.tables as Record<string, number> | undefined) ?? {};
    receipt = buildDeletionReceipt(
      {
        workspaceId,
        jobId,
        requestedAt: job.createdAt,
        cooloffUntil: job.cooloffUntil,
        steps: {
          revoke: at('revoke'),
          dek: at('dek'),
          blobs: at('blobs'),
          rows: at('rows'),
          receipt: { startedAt: receiptState.startedAt },
        },
        auditChainHead: head[0]?.hash ?? null,
        counts: {
          blobs: Number(steps.blobs?.count ?? 0),
          rows: Object.values(tables).reduce((sum, n) => sum + n, 0),
          legalHoldInvoices: Number(steps.rows?.legalHoldInvoices ?? 0),
        },
      },
      deps.secret,
    );
    receiptState.receipt = receipt;
    receiptState.hash = receiptHash(receipt);
    await save('receipt', receiptState);
  }
  const hash = receiptHash(receipt);

  if (receiptState.emailedAt === undefined && receiptState.emailSkipped === undefined) {
    const sent = await emailReceipt(ctx, job.requestedBy, receipt, hash, deps);
    if (sent === 'sent') receiptState.emailedAt = iso();
    else receiptState.emailSkipped = sent;
    await save('receipt', receiptState);
    crash('receipt:emailed');
  }

  const finalized = await withWorkspace(ctx.db, scope, (tx) =>
    tx.execute<{ done: boolean }>(
      sql`select app_finalize_workspace_deletion(${workspaceId}::uuid, ${hash}, ${JSON.stringify(receipt)}::jsonb) as done`,
    ),
  );
  ctx.log.info({ ...fields, finalized: finalized[0]?.done === true }, 'workspace erase finalized');
  return done('erased');
}

type EmailOutcome = 'sent' | 'no_requester' | 'suppressed' | 'rejected';

/** Email the receipt to the requesting owner (content-free: hashes, times and counts). */
async function emailReceipt(
  ctx: EraseCtx,
  requestedBy: string,
  receipt: DeletionReceipt,
  hash: string,
  deps: EraseDeps,
): Promise<EmailOutcome> {
  const [requester] = await ctx.db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, requestedBy));
  const to = requester?.email.trim() ?? '';
  if (to === '') return 'no_requester';
  if (await isSuppressed(ctx.db, to)) return 'suppressed';
  const s = receipt.steps;
  const body = [
    'Your workspace has been erased. This is your deletion receipt; it contains no workspace content.',
    `Receipt hash: ${hash}`,
    `Workspace reference: ${receipt.workspaceIdHash}`,
    `Requested: ${receipt.requestedAt}; cooling-off ended: ${receipt.cooloffUntil ?? '-'}`,
    `Access revoked: ${s.revoke.doneAt}; key destroyed: ${s.dek.doneAt}; files deleted: ${s.blobs.doneAt} (${String(receipt.counts.blobs)}); records purged: ${s.rows.doneAt} (${String(receipt.counts.rows)})`,
    `Audit chain reference: ${receipt.auditChainHead ?? 'none'}`,
    `Invoices kept under legal hold: ${String(receipt.counts.legalHoldInvoices)}`,
  ].join('\n');
  const email = await renderEmail('security-alert', {
    title: 'Workspace deletion receipt',
    body,
    href: new URL('/', deps.appUrl).toString(),
  });
  try {
    await deps.email.send({ to, ...email, tags: { category: 'security.alert' } });
    return 'sent';
  } catch (error) {
    if (isPermanentEmailError(error)) {
      ctx.log.warn({ requestedBy, code: emailErrorCode(error) }, 'deletion receipt rejected');
      return 'rejected';
    }
    throw error;
  }
}
