// Business (#519, D-049): MRR and ARR by plan, active users, conversion, churn, and cost to serve
// per active user (fetch, captcha, AI, infrastructure) with margin and threshold breaches. Admin
// only (`requireStaff('business')`); the read is audited (lib/data) and returns aggregates only.
// Accepted limits: active users come from session activity, and infrastructure is a configured
// monthly figure spread over active users (it is not metered).
import type { Metadata } from 'next';

import {
  businessConfigFromEnv,
  businessMetrics,
  type PlanReport,
} from '../../../lib/data/index.ts';
import { serverEnv } from '../../../lib/env.ts';
import { requireStaff } from '../../../lib/staff.ts';

export const metadata: Metadata = { title: 'Business' };
export const dynamic = 'force-dynamic';

const rupees = (paise: number): string => `Rs ${(paise / 100).toFixed(2)}`;
const percent = (bps: number | null): string => (bps === null ? 'n/a' : `${(bps / 100).toFixed(1)}%`);

const cell = 'px-2 py-1 text-right';
const head = 'px-2 py-1 text-right font-medium';

function PlanRow({ plan }: { plan: PlanReport }) {
  const c = plan.costPerUser;
  return (
    <tr className="border-line border-t">
      <th scope="row" className="px-2 py-1 text-left font-medium">
        {plan.name}
        {plan.overThreshold ? (
          <span role="img" aria-label="over the cost threshold" className="text-danger ml-2">
            Over threshold
          </span>
        ) : null}
      </th>
      <td className={cell}>{plan.subscribers}</td>
      <td className={cell}>{rupees(plan.mrrPaise)}</td>
      <td className={cell}>{rupees(plan.arrPaise)}</td>
      <td className={cell}>{plan.dau}</td>
      <td className={cell}>{plan.wau}</td>
      <td className={cell}>{plan.mau}</td>
      <td className={cell}>{percent(plan.churnBps)}</td>
      <td className={cell}>{rupees(c.fetchPaise)}</td>
      <td className={cell}>{rupees(c.captchaPaise)}</td>
      <td className={cell}>{rupees(c.aiPaise)}</td>
      <td className={cell}>{rupees(c.infraPaise)}</td>
      <td className={cell}>{rupees(c.totalPaise)}</td>
      <td className={cell}>{percent(plan.grossMarginBps)}</td>
    </tr>
  );
}

export default async function BusinessPage() {
  const staff = await requireStaff('business');
  const config = businessConfigFromEnv(serverEnv());
  const { report, breaches } = await businessMetrics(staff, config);
  return (
    <section aria-labelledby="page-title" className="grid gap-4">
      <div className="grid gap-1">
        <h1 id="page-title" className="text-lg font-semibold">
          Business
        </h1>
        <p className="text-ink-muted text-sm">
          This IST month, aggregates only. Active users come from session activity; infrastructure
          is a configured monthly figure spread over active users.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-ink-muted">MRR</dt>
          <dd>{rupees(report.mrrPaise)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">ARR</dt>
          <dd>{rupees(report.arrPaise)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Active users (daily / weekly)</dt>
          <dd>
            {report.dau} / {report.wau}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Free to paid</dt>
          <dd>{percent(report.conversionBps)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Paid churn (30 days)</dt>
          <dd>{percent(report.churnBps)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Gross margin</dt>
          <dd>{percent(report.grossMarginBps)}</dd>
        </div>
      </dl>
      {breaches.length > 0 ? (
        <p role="alert" className="text-danger text-sm">
          Over the {rupees(config.costAlertPaisePerUser)} cost-per-user threshold:{' '}
          {breaches.map((b) => b.name).join(', ')}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Plans: revenue, active users and cost to serve per user</caption>
          <thead>
            <tr>
              <th scope="col" className="px-2 py-1 text-left font-medium">
                Plan
              </th>
              {[
                'Subscribers',
                'MRR',
                'ARR',
                'Daily',
                'Weekly',
                'Monthly',
                'Churn',
                'Fetch',
                'Captcha',
                'AI',
                'Infra',
                'Cost per user',
                'Margin',
              ].map((h) => (
                <th key={h} scope="col" className={head}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.plans.map((p) => (
              <PlanRow key={p.planId} plan={p} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
