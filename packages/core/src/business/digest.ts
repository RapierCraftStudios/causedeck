// The founders' emails (#519): the weekly business digest and the cost-per-user alert. Plain text
// and minimal HTML built from aggregates only; every interpolated value is a number or a plan name
// from the catalogue, escaped for the HTML part.
import type { BusinessReport } from './report.ts';
import type { CostBreach } from './thresholds.ts';

export interface BusinessEmail {
  subject: string;
  text: string;
  html: string;
}

const rupees = (paise: number): string => `Rs ${(paise / 100).toFixed(2)}`;
const percent = (value: number | null): string => (value === null ? 'n/a' : `${(value / 100).toFixed(1)}%`);
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function lines(report: BusinessReport, breaches: readonly CostBreach[]): string[] {
  const out = [
    `MRR ${rupees(report.mrrPaise)}, ARR ${rupees(report.arrPaise)}`,
    `Active users: ${String(report.dau)} daily, ${String(report.wau)} weekly, ${String(report.mau)} monthly`,
    `Free to paid: ${percent(report.conversionBps)}; paid churn (30 days): ${percent(report.churnBps)}`,
    `Gross margin: ${percent(report.grossMarginBps)}`,
    '',
  ];
  for (const p of report.plans) {
    const c = p.costPerUser;
    out.push(
      `${p.name}: ${String(p.mau)} active, cost per user ${rupees(c.totalPaise)} (fetch ${rupees(c.fetchPaise)}, captcha ${rupees(c.captchaPaise)}, AI ${rupees(c.aiPaise)}, infra ${rupees(c.infraPaise)}), margin ${percent(p.grossMarginBps)}`,
    );
  }
  if (breaches.length > 0) {
    out.push('', 'Over the cost-per-user threshold:');
    for (const b of breaches)
      out.push(
        `${b.name}: ${rupees(b.costPerUser.totalPaise)} against ${rupees(b.thresholdPaise)}`,
      );
  }
  return out;
}

function toHtml(rows: readonly string[]): string {
  return `<div>${rows.map((r) => (r === '' ? '<br>' : `<p>${escapeHtml(r)}</p>`)).join('')}</div>`;
}

/** The weekly digest; `weekOf` is the IST date the week ends, `YYYY-MM-DD`. */
export function renderBusinessDigest(
  report: BusinessReport,
  breaches: readonly CostBreach[],
  weekOf: string,
): BusinessEmail {
  const rows = lines(report, breaches);
  return { subject: `CauseDeck business digest, week of ${weekOf}`, text: rows.join('\n'), html: toHtml(rows) };
}

/** The alert sent when a plan's cost per user is over the threshold. */
export function renderCostAlert(breaches: readonly CostBreach[], day: string): BusinessEmail {
  const rows = breaches.map(
    (b) =>
      `${b.name}: cost per user ${rupees(b.costPerUser.totalPaise)} against ${rupees(b.thresholdPaise)} (fetch ${rupees(b.costPerUser.fetchPaise)}, captcha ${rupees(b.costPerUser.captchaPaise)}, AI ${rupees(b.costPerUser.aiPaise)}, infra ${rupees(b.costPerUser.infraPaise)})`,
  );
  return {
    subject: `CauseDeck cost alert ${day}: ${String(breaches.length)} plan(s) over threshold`,
    text: rows.join('\n'),
    html: toHtml(rows),
  };
}
