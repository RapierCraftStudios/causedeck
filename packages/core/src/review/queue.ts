// The staff side of the review queue (#518). Every read of an item's record is audited before the
// record is returned (fail-closed: `staff.read` is a security event), and the list carries no record
// values, so a reviewer sees the record of one item at a time. A fix is final: it fans out to the
// watchers through `app_review_propagate` (staff-only, owner-defined) and cannot be changed after.
import { schema, withUser, type Queryable } from '@causedeck/db';
import { asc, eq, inArray, sql } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import { conflict, invalid, notFound } from '../shared/errors.ts';

const { reviewItem } = schema;

export type ReviewItemRow = typeof reviewItem.$inferSelect;

/** SLA per kind, in hours from creation: a user's report is answered first. */
export const REVIEW_SLA_HOURS: Readonly<Record<schema.ReviewKind, number>> = {
  user_report: 24,
  conflict: 48,
  low_confidence: 72,
};

export function dueAtFor(kind: schema.ReviewKind, now: Date): Date {
  return new Date(now.getTime() + REVIEW_SLA_HOURS[kind] * 3_600_000);
}

/** The acting staff member (the admin console's `StaffMember`). */
export interface ReviewStaff {
  userId: string;
  role?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

/** A queue row: no record values. */
export interface ReviewSummary {
  id: string;
  kind: schema.ReviewKind;
  status: schema.ReviewStatus;
  sourceId: string;
  field: schema.ReviewField | null;
  assigneeId: string | null;
  dueAt: Date;
  overdue: boolean;
  fixtureExportedAt: Date | null;
}

/** Open a content-free source-level item once per source and kind (a dedup'd no-op while one is open). */
export async function enqueueReviewSignal(
  db: Queryable,
  input: { kind: Exclude<schema.ReviewKind, 'user_report'>; sourceId: string; detail: string },
  now: Date = new Date(),
): Promise<{ id: string | null; created: boolean }> {
  const [row] = await db
    .insert(reviewItem)
    .values({
      kind: input.kind,
      sourceId: input.sourceId,
      detail: input.detail,
      dueAt: dueAtFor(input.kind, now),
    })
    .onConflictDoNothing()
    .returning({ id: reviewItem.id });
  return { id: row?.id ?? null, created: row !== undefined };
}

/** Items waiting for a person (`open`, `in_review`) or, with `status`, in that state; soonest due first. */
export async function listReviewItems(
  db: Queryable,
  options: { status?: schema.ReviewStatus; now?: Date } = {},
): Promise<ReviewSummary[]> {
  const now = options.now ?? new Date();
  const rows = await db
    .select()
    .from(reviewItem)
    .where(
      options.status === undefined
        ? inArray(reviewItem.status, ['open', 'in_review'])
        : eq(reviewItem.status, options.status),
    )
    .orderBy(asc(reviewItem.dueAt));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    sourceId: r.sourceId,
    field: r.field,
    assigneeId: r.assigneeId,
    dueAt: r.dueAt,
    overdue: r.status !== 'fixed' && r.status !== 'dismissed' && r.dueAt.getTime() < now.getTime(),
    fixtureExportedAt: r.fixtureExportedAt,
  }));
}

async function audit(db: Queryable, staff: ReviewStaff, purpose: string, id: string) {
  await record(
    {
      db,
      workspaceId: null,
      actor: { userId: staff.userId, kind: 'staff' },
      ...(staff.ip === undefined ? {} : { ip: staff.ip }),
      ...(staff.userAgent === undefined ? {} : { userAgent: staff.userAgent }),
      ...(staff.requestId === undefined ? {} : { requestId: staff.requestId }),
    },
    {
      action: 'staff.read',
      target: { kind: 'review_item', id },
      metadata: {
        purpose,
        capability: 'data-ops',
        ...(staff.role === undefined ? {} : { role: staff.role }),
      },
    },
  );
}

async function load(db: Queryable, id: string): Promise<ReviewItemRow> {
  const [row] = await db.select().from(reviewItem).where(eq(reviewItem.id, id));
  if (row === undefined) throw notFound('Review item not found');
  return row;
}

/** The record under review. Audited first: a read that cannot be logged is not returned. */
export async function getReviewItem(
  db: Queryable,
  staff: ReviewStaff,
  id: string,
): Promise<ReviewItemRow> {
  await audit(db, staff, 'review.view', id);
  return load(db, id);
}

/** Assign an item (or clear the assignee with null); an `open` item moves to `in_review`. */
export async function assignReviewItem(
  db: Queryable,
  staff: ReviewStaff,
  id: string,
  assigneeId: string | null,
): Promise<void> {
  await audit(db, staff, 'review.assign', id);
  const item = await load(db, id);
  if (item.status === 'fixed' || item.status === 'dismissed') {
    throw conflict('The review item is already closed');
  }
  await db
    .update(reviewItem)
    .set({ assigneeId, status: assigneeId === null ? 'open' : 'in_review' })
    .where(eq(reviewItem.id, id));
}

export async function dismissReviewItem(
  db: Queryable,
  staff: ReviewStaff,
  id: string,
): Promise<void> {
  await audit(db, staff, 'review.dismiss', id);
  const item = await load(db, id);
  if (item.status === 'fixed' || item.status === 'dismissed') {
    throw conflict('The review item is already closed');
  }
  await db
    .update(reviewItem)
    .set({ status: 'dismissed', resolvedBy: staff.userId, resolvedAt: new Date() })
    .where(eq(reviewItem.id, id));
}

export interface ReviewFix {
  correctedValue: string;
  /** For a source-level item, the record the reviewer identified; a report already names it. */
  cnr?: string;
  field?: schema.ReviewField;
}

/**
 * Record the fix and fan it out: one `review_correction` per workspace watching the record.
 * Returns the number of watchers corrected (0 for a source-level item with no record named).
 */
export async function resolveReviewItem(
  db: Queryable,
  staff: ReviewStaff,
  id: string,
  fix: ReviewFix,
  now: Date = new Date(),
): Promise<{ propagated: number }> {
  const value = fix.correctedValue.trim();
  if (value === '' || value.length > 200) throw invalid('Enter the corrected value');
  await audit(db, staff, 'review.fix', id);
  const item = await load(db, id);
  if (item.status === 'fixed' || item.status === 'dismissed') {
    throw conflict('The review item is already closed');
  }
  const cnr = item.cnr ?? fix.cnr ?? null;
  const field = item.field ?? fix.field ?? null;
  await db
    .update(reviewItem)
    .set({
      status: 'fixed',
      correctedValue: value,
      cnr,
      field,
      resolvedBy: staff.userId,
      resolvedAt: now,
      assigneeId: item.assigneeId ?? staff.userId,
    })
    .where(eq(reviewItem.id, id));
  if (cnr === null || field === null) return { propagated: 0 };
  const rows = await withUser(db, { userId: staff.userId }, (tx) =>
    tx.execute<{ n: string }>(sql`select app_review_propagate(${id}::uuid) as n`),
  );
  return { propagated: Number(rows[0]?.n ?? 0) };
}

/** Stamp a fixed item as sent to the fixture workbench; the fixture itself is built by the caller. */
export async function markFixtureExported(
  db: Queryable,
  staff: ReviewStaff,
  id: string,
  now: Date = new Date(),
): Promise<void> {
  await audit(db, staff, 'review.fixture', id);
  const item = await load(db, id);
  if (item.status !== 'fixed') throw conflict('Only a fixed item can become a fixture');
  await db.update(reviewItem).set({ fixtureExportedAt: now }).where(eq(reviewItem.id, id));
}
