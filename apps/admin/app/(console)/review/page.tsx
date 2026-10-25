// The review queue (#518, D-049): low-confidence parses, cross-source conflicts and user reports,
// soonest due first. Kind, source, SLA and assignee only: no record values are listed.
import { listReviewItems } from '@causedeck/core/review';
import { db } from '@causedeck/core/runtime';
import type { Metadata } from 'next';
import Link from 'next/link';

import { requireStaff } from '../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Review queue' };

const KIND_LABEL = {
  low_confidence: 'Low confidence',
  conflict: 'Conflict',
  user_report: 'User report',
} as const;

export default async function ReviewQueuePage() {
  await requireStaff('data-ops');
  const items = await listReviewItems(db);
  return (
    <section aria-labelledby="page-title" className="grid gap-4">
      <div className="grid gap-1">
        <h1 id="page-title" className="text-lg font-semibold">
          Review queue
        </h1>
        <p className="text-ink-muted text-sm">
          Items waiting for a person. Open one to see its record; each view is logged.
        </p>
      </div>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Review items</caption>
        <thead>
          <tr>
            <th scope="col">Kind</th>
            <th scope="col">Source</th>
            <th scope="col">Status</th>
            <th scope="col">Assignee</th>
            <th scope="col">Due</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <Link href={`/review/${item.id}`} className="underline">
                  {KIND_LABEL[item.kind]}
                </Link>
              </td>
              <td>{item.sourceId}</td>
              <td>{item.status}</td>
              <td>{item.assigneeId ?? 'Unassigned'}</td>
              <td className={item.overdue ? 'text-danger' : undefined}>
                {item.dueAt.toISOString().slice(0, 16).replace('T', ' ')}
                {item.overdue ? ' (overdue)' : ''}
              </td>
            </tr>
          ))}
          {items.length === 0 ? (
            <tr>
              <td colSpan={5}>Nothing waiting.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
