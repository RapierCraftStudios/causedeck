// The per-user intake address (#54 part 2): `u-` + 10 random base32 characters at the intake
// domain. The local part comes from the system's CSPRNG and is never derived from the user, so
// knowing a member gives no hint of their address. A member has at most one active address;
// rotating retires the old one in the same transaction (it stops resolving at once) and a retired
// `(local_part, domain)` is never reused (the table keeps the row). Members with `workspace.manage`
// create, rotate and revoke, audited fail-closed.
import { randomBytes } from 'node:crypto';

import { schema, withWorkspace, type Queryable } from '@causedeck/db';
import { and, eq, sql } from 'drizzle-orm';

import { conflict, notFound } from '../shared/errors.ts';

import { auditEmailIntake } from './audit.ts';
import type { EmailIntakeCtx } from './context.ts';

const { intakeAddress } = schema;

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const LOCAL_PART_RE = /^u-[a-z2-7]{10}$/;
const MAX_ATTEMPTS = 5;

/** What the settings page may show: the full address belongs to its owner and the workspace admins. */
export interface IntakeAddressView {
  id: string;
  userId: string;
  address: string;
  domain: string;
  status: schema.IntakeAddressStatus;
  createdAt: Date;
  revokedAt: Date | null;
}

/** `u-` + 10 random base32 characters. 256 is a multiple of 32, so the modulo is unbiased. */
export function generateLocalPart(random: (size: number) => Uint8Array = randomBytes): string {
  let out = 'u-';
  for (const byte of random(10)) out += BASE32[byte % 32];
  return out;
}

export function isIntakeLocalPart(value: string): boolean {
  return LOCAL_PART_RE.test(value);
}

type Row = typeof intakeAddress.$inferSelect;

function view(row: Row): IntakeAddressView {
  return {
    id: row.id,
    userId: row.userId,
    address: `${row.localPart}@${row.domain}`,
    domain: row.domain,
    status: row.status,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}

/** The member's active address; null when they have none (or it is not visible to the scope). */
export async function getActiveAddress(
  db: Queryable,
  workspaceId: string,
  userId: string,
): Promise<IntakeAddressView | null> {
  const [row] = await db
    .select()
    .from(intakeAddress)
    .where(
      and(
        eq(intakeAddress.workspaceId, workspaceId),
        eq(intakeAddress.userId, userId),
        eq(intakeAddress.status, 'active'),
      ),
    );
  return row ? view(row) : null;
}

async function insertAddress(
  ctx: EmailIntakeCtx,
  tx: Queryable,
  now: Date,
): Promise<Row> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const [row] = await tx
      .insert(intakeAddress)
      .values({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        localPart: generateLocalPart(),
        domain: ctx.domain.toLowerCase(),
        createdAt: now,
      })
      .onConflictDoNothing({ target: [intakeAddress.localPart, intakeAddress.domain] })
      .returning();
    if (row) return row;
  }
  throw conflict('Could not create an address. Please try again.');
}

/** Create the caller's intake address; a member who already has an active one gets CONFLICT. */
export async function createAddress(ctx: EmailIntakeCtx): Promise<IntakeAddressView> {
  await ctx.authorize('workspace.manage');
  const now = ctx.now?.() ?? new Date();
  return withWorkspace(ctx.db, { workspaceId: ctx.workspaceId, userId: ctx.userId }, async (tx) => {
    if (await getActiveAddress(tx, ctx.workspaceId, ctx.userId)) {
      throw conflict('You already have an intake address. Rotate it to get a new one.');
    }
    const row = await insertAddress(ctx, tx, now);
    await auditEmailIntake(
      ctx,
      tx,
      'email_intake.address_created',
      { kind: 'intake_address', id: row.id },
      { addressId: row.id, domain: row.domain },
    );
    return view(row);
  });
}

/** Replace the caller's active address: the old one stops resolving in the same transaction. */
export async function rotateAddress(ctx: EmailIntakeCtx): Promise<IntakeAddressView> {
  await ctx.authorize('workspace.manage');
  const now = ctx.now?.() ?? new Date();
  return withWorkspace(ctx.db, { workspaceId: ctx.workspaceId, userId: ctx.userId }, async (tx) => {
    const [old] = await tx
      .update(intakeAddress)
      .set({ status: 'revoked', revokedAt: now })
      .where(
        and(
          eq(intakeAddress.workspaceId, ctx.workspaceId),
          eq(intakeAddress.userId, ctx.userId),
          eq(intakeAddress.status, 'active'),
        ),
      )
      .returning({ id: intakeAddress.id });
    if (!old) throw notFound('No intake address to rotate');
    const row = await insertAddress(ctx, tx, now);
    await auditEmailIntake(
      ctx,
      tx,
      'email_intake.address_rotated',
      { kind: 'intake_address', id: row.id },
      { addressId: row.id, replacedAddressId: old.id, domain: row.domain },
    );
    return view(row);
  });
}

/** Revoke an active address of this workspace; an unknown, foreign or already revoked id is NOT_FOUND. */
export async function revokeAddress(ctx: EmailIntakeCtx, addressId: string): Promise<void> {
  await ctx.authorize('workspace.manage');
  const now = ctx.now?.() ?? new Date();
  await withWorkspace(ctx.db, { workspaceId: ctx.workspaceId, userId: ctx.userId }, async (tx) => {
    const [row] = await tx
      .update(intakeAddress)
      .set({ status: 'revoked', revokedAt: now })
      .where(
        and(
          eq(intakeAddress.workspaceId, ctx.workspaceId),
          eq(intakeAddress.id, addressId),
          eq(intakeAddress.status, 'active'),
        ),
      )
      .returning({ id: intakeAddress.id, domain: intakeAddress.domain });
    if (!row) throw notFound('Intake address not found');
    await auditEmailIntake(
      ctx,
      tx,
      'email_intake.address_revoked',
      { kind: 'intake_address', id: row.id },
      { addressId: row.id, domain: row.domain },
    );
  });
}

export interface ResolvedAddress {
  workspaceId: string;
  userId: string;
}

/**
 * The workspace and member an inbound address belongs to, or null. Runs on the app database with
 * no workspace scope (the sender is not a member) through `app_resolve_intake_address`, which
 * returns a row only for an active address: a malformed, unknown, rotated and revoked address are
 * the same `null` (no oracle). Only the address is matched; nothing from the sender is used.
 */
export async function resolveAddress(
  db: Queryable,
  address: string,
): Promise<ResolvedAddress | null> {
  const at = address.lastIndexOf('@');
  if (at < 1) return null;
  const localPart = address.slice(0, at).trim().toLowerCase();
  const domain = address.slice(at + 1).trim().toLowerCase();
  if (!isIntakeLocalPart(localPart) || domain === '' || domain.length > 253) return null;
  const rows = await db.execute<{ workspace_id: string; user_id: string }>(
    sql`select workspace_id, user_id from app_resolve_intake_address(${localPart}, ${domain})`,
  );
  const [row] = rows;
  return row ? { workspaceId: row.workspace_id, userId: row.user_id } : null;
}
