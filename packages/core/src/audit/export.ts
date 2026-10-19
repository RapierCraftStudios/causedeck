// Audit export (#229, #26 part 4): a date range of one workspace's audit log as CSV or JSON Lines,
// streamed page by page from a keyset cursor so memory stays flat however many rows there are.
// Gated by `audit.read`, and the export is itself audited (`audit.exported`, fail-closed) before
// the first byte. Owners get a truncated IP column; nobody gets the raw user agent. See
// docs/engineering/audit.md.
import { withWorkspace } from '@causedeck/db';

import { invalid } from '../workspaces/errors.ts';
import {
  auditPage,
  authorizeAuditRead,
  checkAuditRange,
  positionOf,
  toView,
  type AuditEventView,
  type AuditReadContext,
} from './query.ts';
import { record } from './writer.ts';

/** Export columns in order; `ip` is appended for owners only. */
export const AUDIT_EXPORT_COLUMNS = [
  'id',
  'created_at',
  'actor_user_id',
  'actor_kind',
  'action',
  'target_kind',
  'target_id',
  'outcome',
  'request_id',
  'user_agent_hash',
  'metadata',
  'hash',
] as const;

export type AuditExportFormat = 'csv' | 'jsonl';

export interface AuditExportOptions {
  /** Inclusive. */
  from: Date;
  /** Exclusive. */
  to: Date;
  format: AuditExportFormat;
  /** Prefix the CSV with a UTF-8 byte order mark (Excel). Ignored for JSON Lines. */
  bom?: boolean;
  actorUserId?: string;
  actionGroup?: string;
}

/** The exporter's request, for the `audit.exported` event. */
export interface AuditExportContext extends AuditReadContext {
  requestId?: string;
  userAgent?: string;
  ip?: string;
}

/** Rows fetched per page (one page is the most the stream holds at once). */
const PAGE_SIZE = 1000;
const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
// A cell a spreadsheet would read as a formula gets a leading quote (CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toExportRow(view: AuditEventView, withIp: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: view.id,
    created_at: view.createdAt,
    actor_user_id: view.actorUserId,
    actor_kind: view.actorKind,
    action: view.action,
    target_kind: view.targetKind,
    target_id: view.targetId,
    outcome: view.outcome,
    request_id: view.requestId,
    user_agent_hash: view.userAgentHash,
    metadata: view.metadata,
    hash: view.hash,
  };
  if (withIp) out.ip = view.ip ?? null;
  return out;
}

function csvLine(values: readonly (string | null | undefined)[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}

function encodeRow(view: AuditEventView, format: AuditExportFormat, withIp: boolean): string {
  const row = toExportRow(view, withIp);
  if (format === 'jsonl') return `${JSON.stringify(row)}\n`;
  return csvLine(
    Object.values(row).map((value) =>
      value === null || typeof value === 'string' ? value : JSON.stringify(value),
    ),
  );
}

/**
 * Export `from`..`to` (exclusive) of the workspace's audit log, oldest first. The permission check
 * and the `audit.exported` event happen before this resolves, so a denied or unauditable export
 * never streams a byte; the returned stream then reads one page of rows per pull.
 */
export async function exportAudit(
  ctx: AuditExportContext,
  options: AuditExportOptions,
): Promise<ReadableStream<Uint8Array>> {
  const { from, to, format } = options;
  if (!(from instanceof Date) || !(to instanceof Date)) throw invalid('from and to are required');
  if (format !== 'csv' && format !== 'jsonl') throw invalid('format must be csv or jsonl');
  const range = {
    from,
    to,
    actorUserId: options.actorUserId,
    actionGroup: options.actionGroup,
  };
  checkAuditRange(range);
  const role = await authorizeAuditRead(ctx);
  const withIp = role === 'owner';

  await record(
    {
      db: ctx.db,
      workspaceId: ctx.workspaceId,
      actor: { userId: ctx.userId, kind: 'user' },
      ...(ctx.requestId === undefined ? {} : { requestId: ctx.requestId }),
      ...(ctx.userAgent === undefined ? {} : { userAgent: ctx.userAgent }),
      ...(ctx.ip === undefined ? {} : { ip: ctx.ip }),
    },
    {
      action: 'audit.exported',
      metadata: {
        format,
        from: from.toISOString(),
        to: to.toISOString(),
      },
    },
  );

  const encoder = new TextEncoder();
  let position: ReturnType<typeof positionOf> | undefined;
  let started = false;
  let done = false;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        // Every pull enqueues or closes; an empty pull would leave the reader waiting.
        if (!started && format === 'csv') {
          started = true;
          if (options.bom === true) controller.enqueue(BOM);
          const header = withIp ? [...AUDIT_EXPORT_COLUMNS, 'ip'] : [...AUDIT_EXPORT_COLUMNS];
          controller.enqueue(encoder.encode(csvLine(header)));
          return;
        }
        started = true;
        if (done) return;
        const rows = await withWorkspace(
          ctx.db,
          { workspaceId: ctx.workspaceId, userId: ctx.userId },
          (tx) => auditPage(tx, ctx.workspaceId, range, 'asc', PAGE_SIZE, position),
        );
        const last = rows.at(-1);
        if (last) {
          position = positionOf(last);
          let chunk = '';
          for (const row of rows) chunk += encodeRow(toView(row, withIp), format, withIp);
          controller.enqueue(encoder.encode(chunk));
        }
        if (rows.length < PAGE_SIZE) {
          done = true;
          controller.close();
        }
      },
    },
    // Pull one page at a time: nothing is read ahead of the consumer.
    { highWaterMark: 0 },
  );
}
