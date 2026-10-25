// DPDP controls for the global court-data stores (#486, D-048). `contributed_document` holds party
// names from public cause lists and orders. The app role has no DELETE on it, so both paths blank
// or mask with UPDATE, the way `app_withdraw_contributions` does (0067). A copy past its source's
// retention is blanked (`withdrawn_at` set, content null); an erasure request masks one person's
// name inside the live copies. `fetch_log` is content-free and needs no hook. The docs/legal posture
// file lists what is still waiting on counsel.
import { createHash } from 'node:crypto';

import { schema, withUser, type Queryable } from '@causedeck/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { record } from '../audit/index.ts';

const { staffUser } = schema;

export type CourtDataErasureErrorCode = 'FORBIDDEN' | 'INVALID';

/** An erasure request the service refused. */
export class CourtDataErasureError extends Error {
  constructor(
    readonly code: CourtDataErasureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CourtDataErasureError';
  }
}

export const MASKED_NAME = '[erased]';
export const MIN_ERASURE_SUBJECT_LENGTH = 3;

export interface CourtDataExpiryReport {
  /** Copies blanked in this run. */
  expired: number;
  /** The same count per source id. */
  bySource: Record<string, number>;
}

/**
 * Blank every live `contributed_document` copy past `least(retention_until, contributed_at +
 * source.retention_days)`, so a retention window shortened in the registry also reaches rows
 * already stored. Ledger rows stay. One summary audit event (counts only) when anything expired.
 */
export async function expireCourtData(
  db: Queryable,
  now: Date = new Date(),
): Promise<CourtDataExpiryReport> {
  return db.transaction(async (tx) => {
    const at = now.toISOString();
    const rows = await tx.execute<{ source_id: string }>(
      sql`update contributed_document d
          set content = null, withdrawn_at = ${at}::timestamptz
          from source s
          where s.id = d.source_id
            and d.withdrawn_at is null
            and ${at}::timestamptz >= least(
              d.retention_until,
              d.contributed_at + make_interval(days => s.retention_days)
            )
          returning d.source_id`,
    );
    const bySource: Record<string, number> = {};
    for (const r of rows) bySource[r.source_id] = (bySource[r.source_id] ?? 0) + 1;
    const report = { expired: rows.length, bySource };
    if (report.expired > 0) {
      await record(
        { db: tx, workspaceId: null, actor: { userId: null, kind: 'system' } },
        {
          action: 'court_data.expired',
          metadata: { expired: report.expired, sources: Object.keys(bySource).join(',') },
        },
      );
    }
    return report;
  });
}

export interface CourtDataErasureRequest {
  /** The enabled ops or admin staff member acting on the request. */
  staffUserId: string;
  /** The person's name as it appears in court records. */
  subject: string;
  /** Why the request was accepted (a ticket id or a short note); never the person's details. */
  reason: string;
}

export interface CourtDataErasureReport {
  /** Live copies in which the name was masked. */
  documents: number;
  /** SHA-256 of the lowercased subject, the only trace of it kept (audit log, report). */
  subjectHash: string;
}

/** A case-insensitive pattern for `subject` (POSIX ARE): metacharacters escaped, spaces any whitespace. */
function namePattern(subject: string): string {
  return subject
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&'))
    .join('\\s+');
}

/**
 * Mask one person's name in every live `contributed_document` copy (staff only), audited with a
 * hash of the subject and a count, never the name. `sha256` is left as it was, so contributing the
 * unmasked text again dedupes to the masked copy. Whether the law allows erasure for a given
 * record is a counsel item (⚖); an ineligible request is refused by simply not being filed.
 */
export async function eraseCourtDataSubject(
  db: Queryable,
  request: CourtDataErasureRequest,
): Promise<CourtDataErasureReport> {
  const subject = request.subject.trim();
  if (subject.length < MIN_ERASURE_SUBJECT_LENGTH) {
    throw new CourtDataErasureError(
      'INVALID',
      `The subject must be at least ${String(MIN_ERASURE_SUBJECT_LENGTH)} characters`,
    );
  }
  if (request.reason.trim() === '') {
    throw new CourtDataErasureError('INVALID', 'A reason is required');
  }
  const subjectHash = createHash('sha256').update(subject.toLowerCase()).digest('hex');
  const pattern = namePattern(subject);
  return withUser(db, { userId: request.staffUserId }, async (tx) => {
    const [staff] = await tx
      .select({ userId: staffUser.userId })
      .from(staffUser)
      .where(
        and(
          eq(staffUser.userId, request.staffUserId),
          inArray(staffUser.role, ['ops', 'admin']),
          isNull(staffUser.disabledAt),
        ),
      );
    if (!staff) {
      throw new CourtDataErasureError('FORBIDDEN', 'Only ops or admin staff can erase court data');
    }
    const rows = await tx.execute<{ id: string }>(
      sql`update contributed_document
          set content = regexp_replace(content, ${pattern}, ${MASKED_NAME}, 'gi')
          where withdrawn_at is null and content ~* ${pattern}
          returning id`,
    );
    await record(
      { db: tx, workspaceId: null, actor: { userId: request.staffUserId, kind: 'staff' } },
      {
        action: 'court_data.erased',
        metadata: { subjectHash, documents: rows.length, reason: request.reason.trim() },
      },
    );
    return { documents: rows.length, subjectHash };
  });
}
