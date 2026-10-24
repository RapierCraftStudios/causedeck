// The business report (#519, D-049): pure maths over a `BusinessSnapshot`. Cost to serve per active
// user per plan is AI spend (metered `ai.spend_paise`) plus fetch and captcha cost (metered
// `fetch_log`, dollars converted once here) plus infrastructure. Delegated lookups are charged to the
// advocate's plan; shared fetch cost and the configured infrastructure cost (not metered anywhere)
// are spread evenly over every active user, so a plan's cost follows its headcount.
import type { BusinessSnapshot, PlanSnapshot } from './snapshot.ts';

export interface BusinessConfig {
  /** INR per USD, for fetch_log dollar costs. */
  usdInr: number;
  /** Infrastructure cost for the month, paise. */
  infraCostPaiseMonthly: number;
  /** Cost to serve per active user above which a plan is flagged, paise. */
  costAlertPaisePerUser: number;
}

export interface CostPerUser {
  fetchPaise: number;
  captchaPaise: number;
  aiPaise: number;
  infraPaise: number;
  totalPaise: number;
}

export interface PlanReport {
  planId: string;
  name: string;
  pricePaise: number;
  subscribers: number;
  mrrPaise: number;
  arrPaise: number;
  dau: number;
  wau: number;
  mau: number;
  new30d: number;
  churned30d: number;
  /** Churned over (live at the start of the window), in basis points; null with no base. */
  churnBps: number | null;
  /** Per active user (30 days); all zero when the plan has no active user. */
  costPerUser: CostPerUser;
  /** Total cost to serve the plan this month, paise. */
  costPaise: number;
  /** (MRR - cost) / MRR in basis points; null when the plan earns nothing (the free plan). */
  grossMarginBps: number | null;
  overThreshold: boolean;
}

export interface BusinessReport {
  plans: PlanReport[];
  mrrPaise: number;
  arrPaise: number;
  dau: number;
  wau: number;
  mau: number;
  paidSubscribers: number;
  freeSubscribers: number;
  /** Paid over all live subscriptions, in basis points; null with none. */
  conversionBps: number | null;
  /** Paid plans only; null with no base. */
  churnBps: number | null;
  costPaise: number;
  grossMarginBps: number | null;
}

const dollarsToPaise = (dollars: number, usdInr: number): number => dollars * usdInr * 100;
const bps = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 10_000) : null;

function churnBase(p: Pick<PlanSnapshot, 'subscribers' | 'churned30d' | 'new30d'>): number {
  return Math.max(p.subscribers + p.churned30d - p.new30d, 0);
}

export function buildBusinessReport(
  snapshot: BusinessSnapshot,
  config: BusinessConfig,
): BusinessReport {
  const totalMau = snapshot.plans.reduce((n, p) => n + p.mau, 0);
  const sharedPaise = dollarsToPaise(
    snapshot.shared.fetchDollars + snapshot.shared.captchaDollars,
    config.usdInr,
  );
  const sharedFetchPaise = dollarsToPaise(snapshot.shared.fetchDollars, config.usdInr);
  const sharedCaptchaPaise = sharedPaise - sharedFetchPaise;

  const plans = snapshot.plans.map((p): PlanReport => {
    const share = totalMau > 0 ? p.mau / totalMau : 0;
    const fetch = dollarsToPaise(p.fetchDollars, config.usdInr) + sharedFetchPaise * share;
    const captcha = dollarsToPaise(p.captchaDollars, config.usdInr) + sharedCaptchaPaise * share;
    const infra = config.infraCostPaiseMonthly * share;
    const cost = fetch + captcha + p.aiSpendPaise + infra;
    const per = (value: number) => (p.mau > 0 ? Math.round(value / p.mau) : 0);
    const costPerUser: CostPerUser = {
      fetchPaise: per(fetch),
      captchaPaise: per(captcha),
      aiPaise: per(p.aiSpendPaise),
      infraPaise: per(infra),
      totalPaise: per(cost),
    };
    const mrrPaise = Math.round(p.mrrPaise);
    return {
      planId: p.planId,
      name: p.name,
      pricePaise: p.pricePaise,
      subscribers: p.subscribers,
      mrrPaise,
      arrPaise: mrrPaise * 12,
      dau: p.dau,
      wau: p.wau,
      mau: p.mau,
      new30d: p.new30d,
      churned30d: p.churned30d,
      churnBps: bps(p.churned30d, churnBase(p)),
      costPerUser,
      costPaise: Math.round(cost),
      grossMarginBps: mrrPaise > 0 ? bps(mrrPaise - cost, mrrPaise) : null,
      overThreshold: p.mau > 0 && costPerUser.totalPaise > config.costAlertPaisePerUser,
    };
  });

  const paid = snapshot.plans.filter((p) => p.pricePaise > 0);
  const paidSubscribers = paid.reduce((n, p) => n + p.subscribers, 0);
  const freeSubscribers = snapshot.plans
    .filter((p) => p.pricePaise === 0)
    .reduce((n, p) => n + p.subscribers, 0);
  const mrrPaise = plans.reduce((n, p) => n + p.mrrPaise, 0);
  const costPaise = plans.reduce((n, p) => n + p.costPaise, 0);
  return {
    plans,
    mrrPaise,
    arrPaise: mrrPaise * 12,
    dau: snapshot.plans.reduce((n, p) => n + p.dau, 0),
    wau: snapshot.plans.reduce((n, p) => n + p.wau, 0),
    mau: totalMau,
    paidSubscribers,
    freeSubscribers,
    conversionBps: bps(paidSubscribers, paidSubscribers + freeSubscribers),
    churnBps: bps(
      paid.reduce((n, p) => n + p.churned30d, 0),
      paid.reduce((n, p) => n + churnBase(p), 0),
    ),
    costPaise,
    grossMarginBps: mrrPaise > 0 ? bps(mrrPaise - costPaise, mrrPaise) : null,
  };
}

/** The three business settings from the server env. */
export function businessConfigFromEnv(env: {
  BUSINESS_USD_INR: number;
  BUSINESS_INFRA_COST_PAISE_MONTHLY: number;
  BUSINESS_COST_PER_USER_ALERT_PAISE: number;
}): BusinessConfig {
  return {
    usdInr: env.BUSINESS_USD_INR,
    infraCostPaiseMonthly: env.BUSINESS_INFRA_COST_PAISE_MONTHLY,
    costAlertPaisePerUser: env.BUSINESS_COST_PER_USER_ALERT_PAISE,
  };
}
