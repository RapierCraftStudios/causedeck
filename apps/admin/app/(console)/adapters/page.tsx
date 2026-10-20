import type { Metadata } from 'next';

import { AdapterHealthTable } from '../../../components/adapter-health-table.tsx';
import { registryHealthSource } from '../../../lib/adapter-health.ts';
import { requireStaff } from '../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Adapters' };

export default async function AdaptersPage() {
  const staff = await requireStaff('adapters');
  const entries = await registryHealthSource(staff).list();
  return (
    <section aria-labelledby="page-title" className="grid gap-4">
      <div className="grid gap-1">
        <h1 id="page-title" className="text-lg font-semibold">
          Adapters
        </h1>
        <p className="text-ink-muted text-sm">
          Court adapters from the access-mode registry. Health collection arrives with Court Graph.
        </p>
      </div>
      <AdapterHealthTable entries={entries} />
    </section>
  );
}
