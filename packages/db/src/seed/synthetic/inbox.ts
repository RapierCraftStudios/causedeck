// The synthetic capture inbox (#48): fictional proposals and captures for stories and e2e. One
// workspace's worth: open proposals of each shape the inbox draws (a next date, a conflicting next
// date, a new matter, a task, a direction from an order), captures in flight (received, scanning,
// queued, processing) and one unreadable capture. Pure like matters.ts: it returns rows for one
// workspace and writes nothing (`insertSyntheticInbox` in index.ts inserts them). Fictional only,
// deterministic (ids derive from the workspace and a running number), idempotent
// (`onConflictDoNothing`) and never in production.
import { createHash } from 'node:crypto';

import type { InferInsertModel } from 'drizzle-orm';

import type { proposal } from '../../schema/automation.ts';
import type { capture } from '../../schema/capture.ts';

export const SYNTHETIC_INBOX_PROPOSALS = 6;
export const SYNTHETIC_INBOX_CAPTURES = 5;

export interface SyntheticInboxOptions {
  workspaceId: string;
  /** A matter of the workspace the proposals belong to (from the matter set). */
  matterId: string;
  /** A proceeding of that matter. */
  proceedingId: string;
  /** The seed day (`yyyy-mm-dd`, Asia/Kolkata). */
  today: string;
}

export interface SyntheticInbox {
  workspaceId: string;
  proposals: InferInsertModel<typeof proposal>[];
  captures: InferInsertModel<typeof capture>[];
}

/** A deterministic v4-shaped uuid from the workspace and a label. */
function idFor(workspaceId: string, label: string): string {
  const hex = createHash('sha256').update(`inbox:${workspaceId}:${label}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** `today` plus `days`, as `yyyy-mm-dd`. */
function plusDays(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function syntheticInbox(options: SyntheticInboxOptions): SyntheticInbox {
  const { workspaceId, matterId, proceedingId, today } = options;
  // Newest first by a minute each, so the order is fixed.
  const at = (minutes: number) =>
    new Date(new Date(`${today}T04:00:00Z`).getTime() - minutes * 60_000);
  const base = { workspaceId, level: 'L2' as const, status: 'proposed' as const };
  const draft = (
    label: string,
    kind: string,
    payload: Record<string, unknown>,
    extra: Partial<InferInsertModel<typeof proposal>> = {},
  ): InferInsertModel<typeof proposal> => ({
    ...base,
    id: idFor(workspaceId, label),
    kind,
    payload,
    idempotencyKey: `synthetic-inbox-${label}`,
    confidence: '0.930',
    matterId,
    proceedingId,
    createdAt: at(SYNTHETIC_INBOX_PROPOSALS),
    ...extra,
  });

  const proposals = [
    draft('next-date', 'next_date', { proceedingId, date: plusDays(today, 14) }),
    draft(
      'next-date-conflict',
      'next_date',
      { proceedingId, date: plusDays(today, 21) },
      { entityRefs: { conflict: true }, needsYou: true, needsYouReason: 'conflict' },
    ),
    draft(
      'new-matter',
      'new_matter',
      { title: 'Meera Rao v. Example Traders (fictional)' },
      { matterId: null, proceedingId: null },
    ),
    draft('task', 'task', { title: 'File the counter (fictional)', dueDate: plusDays(today, 7) }),
    draft('direction', 'obligation_from_direction', {
      matterId,
      description: 'File the compliance report',
      dueDate: plusDays(today, 10),
    }),
    draft(
      'low-confidence',
      'task',
      { title: 'Collect the certified copy (fictional)' },
      {
        confidence: '0.420',
        needsYou: true,
        needsYouReason: 'low confidence',
      },
    ),
  ];

  const row = (
    label: string,
    status: InferInsertModel<typeof capture>['status'],
    channel: InferInsertModel<typeof capture>['channel'],
  ): InferInsertModel<typeof capture> => ({
    id: idFor(workspaceId, `capture-${label}`),
    workspaceId,
    channel,
    status,
    mime: 'application/pdf',
    sizeBytes: 120_000,
    createdAt: at(SYNTHETIC_INBOX_CAPTURES),
  });
  const captures = [
    row('received', 'received', 'upload'),
    row('scanning', 'scanning', 'share'),
    row('queued', 'queued', 'voice'),
    row('processing', 'processing', 'camera'),
    row('unreadable', 'needs_you', 'camera'),
  ];
  return { workspaceId, proposals, captures };
}
