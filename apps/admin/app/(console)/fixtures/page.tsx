import type { Metadata } from 'next';

import { WORKBENCH_ADAPTERS } from '@causedeck/adapters/workbench';

import { FixtureWorkbenchForm } from '../../../components/fixture-workbench-form.tsx';
import { requireStaff } from '../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Fixture workbench' };

export default async function FixturesPage() {
  await requireStaff('adapters');
  return (
    <section aria-labelledby="page-title" className="grid gap-4">
      <div className="grid gap-1">
        <h1 id="page-title" className="text-lg font-semibold">
          Fixture workbench
        </h1>
        <p className="text-ink-muted text-sm">
          Run an adapter on a contributed document, correct what it read, and download a redacted
          fixture. Party names and personal data are replaced before anything is returned; the
          document is not stored. Commit the download with{' '}
          <code>pnpm --filter @causedeck/adapters fixtures:export</code> and open a PR.
        </p>
      </div>
      <FixtureWorkbenchForm adapterIds={Object.keys(WORKBENCH_ADAPTERS).sort()} />
    </section>
  );
}
