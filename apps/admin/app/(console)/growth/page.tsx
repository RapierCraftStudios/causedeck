import { EmptyState } from '@causedeck/ui/empty-state';
import type { Metadata } from 'next';
import Link from 'next/link';

import {
  ACTIVATION_CHANNELS,
  ACTIVATION_STEPS,
  growthFunnel,
  growthReferralFunnel,
  type ActivationChannel,
  type ActivationStep,
} from '../../../lib/data/index.ts';
import { requireStaff } from '../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Growth' };

interface SearchParams {
  channel?: string | string[];
}

const STEP_LABELS: Readonly<Record<ActivationStep, string>> = {
  signed_up: 'Signed up',
  workspace_created: 'Workspace created',
  identifiers_entered: 'Identifiers entered',
  discovery_found: 'Discovery found',
  confirm_grid_done: 'Confirm grid done',
  first_court_day_view: 'First court-day view',
  first_alert: 'First alert',
  first_brief: 'First brief',
  whatsapp_linked: 'WhatsApp linked',
  invite_sent: 'Invite sent',
};

function channelOf(raw: string | string[] | undefined): ActivationChannel | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (ACTIVATION_CHANNELS as readonly string[]).includes(value ?? '')
    ? (value as ActivationChannel)
    : undefined;
}

function percent(ratio: number): string {
  return `${String(Math.round(ratio * 100))}%`;
}

/** Seconds as `2d 3h`, `5h 10m` or `42m`; `-` when nobody reached the step. */
function formatDuration(seconds: number | null): string {
  if (seconds === null) return '-';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ${String(minutes % 60)}m`;
  return `${String(Math.floor(hours / 24))}d ${String(hours % 24)}h`;
}

/** The activation funnel (#509, D-030): counts and ratios per weekly cohort; no user ids or content. */
export default async function GrowthPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const staff = await requireStaff('growth');
  const channel = channelOf((await searchParams).channel);
  const { cohorts, timeToFirstCourtDay } = await growthFunnel(
    staff,
    channel === undefined ? {} : { channel },
  );
  const referrals = await growthReferralFunnel(staff);
  const ttv = new Map(timeToFirstCourtDay.map((t) => [t.week, t]));
  return (
    <section aria-labelledby="page-title" className="grid gap-4">
      <div className="grid gap-1">
        <h1 id="page-title" className="text-lg font-semibold">
          Growth
        </h1>
        <p className="text-ink-muted text-sm">
          Step conversion by weekly sign-up cohort (weeks start Monday, India time) and time from
          sign-up to the first court-day view.
        </p>
      </div>
      <nav aria-label="Channel" className="flex flex-wrap gap-2 text-sm">
        <Link href="/growth" aria-current={channel === undefined ? 'page' : undefined}>
          All channels
        </Link>
        {ACTIVATION_CHANNELS.map((c) => (
          <Link
            key={c}
            href={`/growth?channel=${c}`}
            aria-current={channel === c ? 'page' : undefined}
          >
            {c}
          </Link>
        ))}
      </nav>
      <dl aria-label="Referral funnel" className="flex flex-wrap gap-6 text-sm tabular-nums">
        <div>
          <dt className="text-ink-muted">Invites sent</dt>
          <dd data-testid="referral-sent">{String(referrals.invitesSent)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Accepted</dt>
          <dd data-testid="referral-accepted">{String(referrals.accepted)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Activated</dt>
          <dd data-testid="referral-activated">{String(referrals.activated)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Credited</dt>
          <dd data-testid="referral-credited">{String(referrals.credited)}</dd>
        </div>
      </dl>
      {cohorts.length === 0 ? (
        <EmptyState
          title="No sign-ups yet."
          description="Cohorts appear after the first sign-up."
        />
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-ink-muted">
            <tr>
              <th className="py-1 font-medium">Cohort week</th>
              {ACTIVATION_STEPS.map((step) => (
                <th key={step} className="py-1 font-medium">
                  {STEP_LABELS[step]}
                </th>
              ))}
              <th className="py-1 font-medium">Time to first court-day view (median / p90)</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {cohorts.map((cohort) => {
              const t = ttv.get(cohort.week);
              return (
                <tr key={cohort.week} data-testid="cohort-row" className="border-line border-t">
                  <td className="py-1 font-mono text-xs">{cohort.week}</td>
                  {cohort.steps.map((s) => (
                    <td key={s.step} className="py-1">
                      {s.step === 'signed_up'
                        ? String(s.users)
                        : `${String(s.users)} (${percent(s.conversion)})`}
                    </td>
                  ))}
                  <td className="py-1">
                    {formatDuration(t?.medianSeconds ?? null)} /{' '}
                    {formatDuration(t?.p90Seconds ?? null)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
