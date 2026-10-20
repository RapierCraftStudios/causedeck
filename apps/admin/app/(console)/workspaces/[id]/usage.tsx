// A workspace's usage metadata for staff (#224, #30 part 7): each metered key's newest counter and
// the AI budget overrides, with who set them, why, and when they end or were ended early. No
// customer content. Admin staff also get the forms to set an override or expire an active one.
import { Badge, type BadgeTone } from '@causedeck/ui/badge';

import type { StaffBudgetOverride, StaffWorkspaceUsage } from '../../../../lib/data/index.ts';
import { canOverrideBudget } from '../../../../lib/roles.ts';
import type { StaffMember } from '../../../../lib/staff.ts';

import { ExpireOverrideForm, SetOverrideForm } from './override-forms.tsx';

const PAISE_KEY = /_paise$/;

function formatDate(date: Date | null): string {
  return date === null ? '—' : date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function formatRupees(paise: number): string {
  return `Rs ${(paise / 100).toFixed(2)}`;
}

function formatValue(key: string, value: number): string {
  return PAISE_KEY.test(key) ? `${formatRupees(value)} (${String(value)} paise)` : String(value);
}

type OverrideStatus = 'active' | 'expired' | 'expired early';

function statusOf(override: StaffBudgetOverride, now: Date): OverrideStatus {
  if (override.expiredAt !== null) return 'expired early';
  return override.expiresAt.getTime() > now.getTime() ? 'active' : 'expired';
}

const TONES: Record<OverrideStatus, BadgeTone> = {
  active: 'success',
  expired: 'neutral',
  'expired early': 'warning',
};

/** Renders what the page read through the data layer (`workspaceUsage`, audited `staff.read`). */
export function WorkspaceUsage({
  staff,
  workspaceId,
  usage,
}: {
  staff: StaffMember;
  workspaceId: string;
  usage: StaffWorkspaceUsage | null;
}) {
  const counters = usage?.counters ?? [];
  const overrides = usage?.overrides ?? [];
  const canWrite = canOverrideBudget(staff.role);
  const now = new Date();
  return (
    <section aria-labelledby="usage" className="grid gap-4">
      <h2 id="usage" className="text-base font-medium">
        Usage
      </h2>
      {counters.length === 0 ? (
        <p className="text-ink-muted text-sm">No usage recorded yet.</p>
      ) : (
        <table className="w-full max-w-2xl text-left text-sm">
          <thead className="text-ink-muted">
            <tr>
              <th scope="col" className="font-normal">
                Key
              </th>
              <th scope="col" className="font-normal">
                Value
              </th>
              <th scope="col" className="font-normal">
                Period from
              </th>
            </tr>
          </thead>
          <tbody>
            {counters.map((c) => (
              <tr key={c.key}>
                <td>
                  <code className="font-mono">{c.key}</code>
                </td>
                <td className="tabular-nums">{formatValue(c.key, c.value)}</td>
                <td className="tabular-nums">{formatDate(c.periodStart)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <section aria-labelledby="overrides" className="grid gap-3">
        <h2 id="overrides" className="text-base font-medium">
          AI budget overrides
        </h2>
        {overrides.length === 0 ? (
          <p className="text-ink-muted text-sm">No budget overrides.</p>
        ) : (
          <ul className="grid gap-3 text-sm">
            {overrides.map((o) => {
              const status = statusOf(o, now);
              return (
                <li key={o.id} className="border-line grid gap-1 rounded-md border p-3">
                  <p className="flex items-center gap-2">
                    <span className="font-medium tabular-nums">{formatRupees(o.limitValue)}</span>
                    <code className="text-ink-muted font-mono">{o.key}</code>
                    <Badge tone={TONES[status]}>{status}</Badge>
                  </p>
                  <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
                    <dt className="text-ink-muted">Reason</dt>
                    <dd>{o.reason}</dd>
                    <dt className="text-ink-muted">Set by</dt>
                    <dd className="font-mono">{o.setBy}</dd>
                    <dt className="text-ink-muted">Set</dt>
                    <dd className="tabular-nums">{formatDate(o.createdAt)}</dd>
                    <dt className="text-ink-muted">Expires</dt>
                    <dd className="tabular-nums">{formatDate(o.expiresAt)}</dd>
                    {o.expiredAt === null ? null : (
                      <>
                        <dt className="text-ink-muted">Expired early</dt>
                        <dd className="tabular-nums">
                          {formatDate(o.expiredAt)} by{' '}
                          <span className="font-mono">{o.expiredBy ?? '—'}</span>
                        </dd>
                        <dt className="text-ink-muted">Expiry reason</dt>
                        <dd>{o.expireReason ?? '—'}</dd>
                      </>
                    )}
                  </dl>
                  {canWrite && status === 'active' ? (
                    <ExpireOverrideForm workspaceId={workspaceId} overrideId={o.id} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {canWrite ? <SetOverrideForm workspaceId={workspaceId} /> : null}
      </section>
    </section>
  );
}
