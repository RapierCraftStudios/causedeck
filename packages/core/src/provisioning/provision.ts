// Bulk seat provisioning from a CSV (#684, part of #508). A run needs `member.invite`, parses the
// file, and for each row either skips an address that is already an active member or invites it
// (the invitation email carries the sign-in link, so the report never reveals whether an address
// has an account). A dry run plans the same outcomes and writes only its `provisioning_run` row.
// The run keeps its own row cap (`MAX_PROVISIONING_ROWS`) instead of the hourly invite limit; the
// role and seat checks of `inviteMember` still apply per row. One audit event closes each run.
import type { Mailer } from '@causedeck/auth/mailer';
import type { AuthLocale } from '@causedeck/auth/messages';
import { invitableRoles, isRole } from '@causedeck/auth/policy';
import { schema, type Database, type Transaction } from '@causedeck/db';
import { and, eq, sql } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import {
  getRoleSettings,
  inviteMember,
  requireCan,
  toPolicySettings,
  WorkspaceError,
} from '../workspaces/index.ts';
import { parseProvisioningCsv, type ProvisioningCsvRow } from './csv.ts';

type Queryable = Database | Transaction;

const { member, provisioningRun, user } = schema;

export type ProvisioningRowOutcome = 'invited' | 'skipped' | 'error';

/** Why a row was skipped or failed; the dialog shows a translated line per reason. */
export type ProvisioningRowReason =
  | 'alreadyMember'
  | 'forbidden'
  | 'conflict'
  | 'invalid'
  | 'seatLimit'
  | 'failed';

export interface ProvisioningReportRow {
  line: number;
  email: string | null;
  outcome: ProvisioningRowOutcome;
  reason?: ProvisioningRowReason;
  /** The CSV problem for a row that did not parse. */
  message?: string;
}

export interface ProvisioningReport {
  runId: string;
  dryRun: boolean;
  totalRows: number;
  /** Rows invited (or, in a dry run, that would be). */
  created: number;
  skipped: number;
  errors: number;
  rows: ProvisioningReportRow[];
}

export interface ProvisionFromCsvRequest {
  workspaceId: string;
  actorUserId: string;
  csv: string;
  dryRun: boolean;
  mailer: Mailer;
  /** Origin the `/invite/<token>` link is built on (`APP_URL`). */
  appUrl: string;
  locale?: AuthLocale | undefined;
}

function reasonFor(error: unknown): ProvisioningRowReason {
  if (error instanceof WorkspaceError) {
    if (error.code === 'FORBIDDEN') return 'forbidden';
    if (error.code === 'CONFLICT') return 'conflict';
    if (error.code === 'VALIDATION') return 'invalid';
    return 'failed';
  }
  // The billing seat gate's `ENTITLEMENT_EXCEEDED`, matched by shape like the members actions.
  if (
    error instanceof Error &&
    error.name === 'EntitlementError' &&
    (error as Error & { code?: unknown }).code === 'ENTITLEMENT_EXCEEDED'
  ) {
    return 'seatLimit';
  }
  return 'failed';
}

async function activeMemberEmails(
  tx: Queryable,
  workspaceId: string,
  emails: readonly string[],
): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const found = await tx
    .select({ email: sql<string>`lower(${user.email})` })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.organizationId, workspaceId),
        eq(member.status, 'active'),
        sql`lower(${user.email}) in (${sql.join(
          emails.map((email) => sql`${email}`),
          sql`, `,
        )})`,
      ),
    );
  return new Set(found.map((row) => row.email));
}

/** The roles the actor may grant here (`member.invite`, rank and the advocates-can-invite setting). */
async function grantableRoles(tx: Queryable, workspaceId: string, actorUserId: string) {
  const [actor] = await tx
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.organizationId, workspaceId),
        eq(member.userId, actorUserId),
        eq(member.status, 'active'),
      ),
    );
  if (!actor || !isRole(actor.role)) return [];
  return invitableRoles(actor.role, toPolicySettings(await getRoleSettings(tx, workspaceId)));
}

/**
 * Provision `request.csv`. Run it inside the workspace scope (the caller's transaction). Row
 * failures never abort the run; a file that cannot be read at all (no `email` column, empty) is
 * reported as one error row and counted as a run with no rows.
 */
export async function provisionFromCsv(
  db: Queryable,
  request: ProvisionFromCsvRequest,
): Promise<ProvisioningReport> {
  return db.transaction(async (tx) => {
    await requireCan(tx, request.workspaceId, request.actorUserId, 'member.invite');
    const parsed = parseProvisioningCsv(request.csv);
    const [run] = await tx
      .insert(provisioningRun)
      .values({
        workspaceId: request.workspaceId,
        source: 'csv',
        status: 'running',
        dryRun: request.dryRun,
        createdBy: request.actorUserId,
        startedAt: new Date(),
      })
      .returning({ id: provisioningRun.id });
    if (!run) throw new Error('provisioning run insert returned no row');

    const members = await activeMemberEmails(
      tx,
      request.workspaceId,
      parsed.rows.map((row) => row.email),
    );
    const grantable = await grantableRoles(tx, request.workspaceId, request.actorUserId);
    const rows: ProvisioningReportRow[] = parsed.errors.map((e) => ({
      line: e.line,
      email: null,
      outcome: 'error',
      message: e.message,
    }));

    for (const row of parsed.rows) {
      rows.push(await provisionRow(tx, request, row, members, grantable));
    }
    rows.sort((a, b) => a.line - b.line);

    const count = (outcome: ProvisioningRowOutcome) =>
      rows.filter((r) => r.outcome === outcome).length;
    const report: ProvisioningReport = {
      runId: run.id,
      dryRun: request.dryRun,
      totalRows: rows.length,
      created: count('invited'),
      skipped: count('skipped'),
      errors: count('error'),
      rows,
    };
    await tx
      .update(provisioningRun)
      .set({
        status: 'succeeded',
        totalRows: report.totalRows,
        createdCount: report.created,
        skippedCount: report.skipped,
        errorCount: report.errors,
        report: rows,
        finishedAt: new Date(),
      })
      .where(eq(provisioningRun.id, run.id));
    await record(
      {
        db: tx,
        workspaceId: request.workspaceId,
        actor: { userId: request.actorUserId, kind: 'user' },
      },
      {
        action: 'provisioning.run',
        target: { kind: 'provisioning_run', id: run.id },
        metadata: {
          source: 'csv',
          dryRun: request.dryRun,
          rows: report.totalRows,
          created: report.created,
          skipped: report.skipped,
          errors: report.errors,
        },
      },
    );
    return report;
  });
}

async function provisionRow(
  tx: Transaction,
  request: ProvisionFromCsvRequest,
  row: ProvisioningCsvRow,
  members: ReadonlySet<string>,
  grantable: readonly string[],
): Promise<ProvisioningReportRow> {
  const base = { line: row.line, email: row.email };
  if (members.has(row.email)) {
    return { ...base, outcome: 'skipped', reason: 'alreadyMember' };
  }
  if (!grantable.includes(row.role)) return { ...base, outcome: 'error', reason: 'forbidden' };
  if (request.dryRun) return { ...base, outcome: 'invited' };
  try {
    await inviteMember(tx, {
      workspaceId: request.workspaceId,
      actorUserId: request.actorUserId,
      input: { email: row.email, role: row.role },
      mailer: request.mailer,
      appUrl: request.appUrl,
      locale: request.locale,
      bypassRateLimit: true,
    });
    return { ...base, outcome: 'invited' };
  } catch (error) {
    return { ...base, outcome: 'error', reason: reasonFor(error) };
  }
}
