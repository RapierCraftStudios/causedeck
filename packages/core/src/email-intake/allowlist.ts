// The sender allow-list (#54 part 2): exact addresses or whole domains a workspace accepts
// forwards from, each tagged with a kind (court, efiling, self, briefing_counsel). Members with
// `workspace.manage` add and remove entries, audited fail-closed; the audit metadata holds the
// kind and whether the entry is a domain, never the pattern itself.
import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import { and, asc, eq } from 'drizzle-orm';

import { conflict, invalid, notFound } from '../shared/errors.ts';

import { auditEmailIntake } from './audit.ts';
import type { EmailIntakeCtx } from './context.ts';

const { intakeAllowlist } = schema;

export const ALLOWLIST_KINDS = schema.INTAKE_ALLOWLIST_KINDS;
export const MAX_ALLOWLIST_LABEL_LENGTH = 80;

const LABEL = '[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?';
const DOMAIN_RE = new RegExp(`^(${LABEL}\\.)+[a-z]{2,63}$`);
const ADDRESS_RE = new RegExp(`^[a-z0-9._%+-]{1,64}@(${LABEL}\\.)+[a-z]{2,63}$`);

export interface AllowlistEntry {
  id: string;
  pattern: string;
  kind: schema.IntakeAllowlistKind;
  label: string | null;
  isDomain: boolean;
  createdAt: Date;
}

export interface AddAllowlistEntryInput {
  /** An exact address (`clerk@court.gov.in`) or a domain (`court.gov.in`). */
  pattern: string;
  kind: string;
  label?: string | null;
}

/** The lower-cased pattern and whether it is a domain; VALIDATION when it is neither. */
export function normalizePattern(raw: string): { pattern: string; isDomain: boolean } {
  const pattern = raw.trim().toLowerCase();
  if (pattern.length > 254) throw invalid('That address or domain is too long');
  if (ADDRESS_RE.test(pattern)) return { pattern, isDomain: false };
  if (DOMAIN_RE.test(pattern)) return { pattern, isDomain: true };
  throw invalid('Enter an email address or a domain, like clerk@court.gov.in or court.gov.in');
}

function entry(row: typeof intakeAllowlist.$inferSelect): AllowlistEntry {
  return {
    id: row.id,
    pattern: row.pattern,
    kind: row.kind,
    label: row.label,
    isDomain: !row.pattern.includes('@'),
    createdAt: row.createdAt,
  };
}

/** The workspace's allow-list, oldest first; empty when none (or not visible to the scope). */
export async function listAllowlist(db: Queryable, workspaceId: string): Promise<AllowlistEntry[]> {
  const rows = await db
    .select()
    .from(intakeAllowlist)
    .where(eq(intakeAllowlist.workspaceId, workspaceId))
    .orderBy(asc(intakeAllowlist.createdAt), asc(intakeAllowlist.id));
  return rows.map(entry);
}

export async function addAllowlistEntry(
  ctx: EmailIntakeCtx,
  input: AddAllowlistEntryInput,
): Promise<AllowlistEntry> {
  await ctx.authorize('workspace.manage');
  const { pattern, isDomain } = normalizePattern(input.pattern);
  const kind = (ALLOWLIST_KINDS as readonly string[]).find((k) => k === input.kind);
  if (!kind) throw invalid('Choose what kind of sender this is');
  const label = input.label?.trim() ?? '';
  if (label.length > MAX_ALLOWLIST_LABEL_LENGTH) throw invalid('That label is too long');
  return withWorkspace(ctx.db, { workspaceId: ctx.workspaceId, userId: ctx.userId }, async (tx) => {
    const [row] = await tx
      .insert(intakeAllowlist)
      .values({
        workspaceId: ctx.workspaceId,
        pattern,
        kind: kind as schema.IntakeAllowlistKind,
        label: label === '' ? null : label,
        addedBy: ctx.userId,
        ...(ctx.now ? { createdAt: ctx.now() } : {}),
      })
      .onConflictDoNothing({ target: [intakeAllowlist.workspaceId, intakeAllowlist.pattern] })
      .returning();
    if (!row) throw conflict('That sender is already on the list');
    await auditEmailIntake(
      ctx,
      tx,
      'email_intake.allowlist_added',
      { kind: 'intake_allowlist', id: row.id },
      { entryId: row.id, kind, isDomain },
    );
    return entry(row);
  });
}

export async function removeAllowlistEntry(ctx: EmailIntakeCtx, entryId: string): Promise<void> {
  await ctx.authorize('workspace.manage');
  await withWorkspace(ctx.db, { workspaceId: ctx.workspaceId, userId: ctx.userId }, async (tx) => {
    const [row] = await tx
      .delete(intakeAllowlist)
      .where(and(eq(intakeAllowlist.workspaceId, ctx.workspaceId), eq(intakeAllowlist.id, entryId)))
      .returning({ id: intakeAllowlist.id });
    if (!row) throw notFound('Allow-list entry not found');
    await auditEmailIntake(
      ctx,
      tx,
      'email_intake.allowlist_removed',
      { kind: 'intake_allowlist', id: row.id },
      { entryId: row.id },
    );
  });
}
