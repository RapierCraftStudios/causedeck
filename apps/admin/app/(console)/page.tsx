import { FLAGS } from '@causedeck/flags/keys';
import type { Metadata } from 'next';

import { activeStaffCount } from '../../lib/data/index.ts';
import { serverEnv } from '../../lib/env.ts';
import { requireStaff } from '../../lib/staff.ts';

export const metadata: Metadata = { title: 'Overview' };

export default async function OverviewPage() {
  const staff = await requireStaff('overview');
  const staffCount = await activeStaffCount(staff);
  // `KILL_*` switches are read from the env, not the database (#22); flag management is #311.
  const { killSwitches } = serverEnv();
  const forcedOff = Object.values(FLAGS).filter(
    (flag) => killSwitches[flag.killSwitchEnv] === true,
  );
  return (
    <section aria-labelledby="page-title" className="grid gap-6">
      <h1 id="page-title" className="text-lg font-semibold">
        Overview
      </h1>
      <dl className="border-line bg-surface-raised grid max-w-xs gap-1 rounded-md border p-4">
        <dt className="text-ink-muted text-sm">Active staff accounts</dt>
        <dd className="text-2xl font-semibold tabular-nums">{staffCount}</dd>
      </dl>
      <section aria-labelledby="kill-switches" className="grid gap-2">
        <h2 id="kill-switches" className="text-base font-medium">
          Kill switches
        </h2>
        {forcedOff.length === 0 ? (
          <p className="text-ink-muted text-sm">No flags are forced off by the environment.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {forcedOff.map((flag) => (
              <li key={flag.key}>
                <code className="font-mono">{flag.key}</code>: Forced off by environment (
                <code className="font-mono">{flag.killSwitchEnv}</code>)
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
