// Cost-per-user thresholds (#519): a plan breaches when its monthly cost to serve per active user
// is above `BusinessConfig.costAlertPaisePerUser`. Plans with no active user never breach.
import type { BusinessReport, CostPerUser } from './report.ts';

export interface CostBreach {
  planId: string;
  name: string;
  costPerUser: CostPerUser;
  thresholdPaise: number;
}

/** The plans over `thresholdPaise`, most expensive first. */
export function evaluateCostThresholds(report: BusinessReport, thresholdPaise: number): CostBreach[] {
  return report.plans
    .filter((p) => p.mau > 0 && p.costPerUser.totalPaise > thresholdPaise)
    .map((p) => ({ planId: p.planId, name: p.name, costPerUser: p.costPerUser, thresholdPaise }))
    .sort((a, b) => b.costPerUser.totalPaise - a.costPerUser.totalPaise);
}
