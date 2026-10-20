import type { Metadata } from 'next';

import { activeStaffCount } from '../../lib/data/index.ts';
import { requireStaff } from '../../lib/staff.ts';

export const metadata: Metadata = { title: 'Overview' };

export default async function OverviewPage() {
  const staff = await requireStaff('overview');
  const staffCount = await activeStaffCount(staff);
  return (
    <section aria-labelledby="page-title" className="grid gap-4">
      <h1 id="page-title" className="text-lg font-semibold">
        Overview
      </h1>
      <dl className="border-line bg-surface-raised grid max-w-xs gap-1 rounded-md border p-4">
        <dt className="text-ink-muted text-sm">Active staff accounts</dt>
        <dd className="text-2xl font-semibold tabular-nums">{staffCount}</dd>
      </dl>
    </section>
  );
}
