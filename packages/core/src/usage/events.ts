// Usage notification events (#221, #30 part 4). The `usage.warning` notice goes to workspace owners
// through the `billing.notice` category (in-app and email by default) once per metered key and IST
// period: its dedupe key names both. The copy is calm (#30 UI spec) and carries no customer content.
import type { UsageKey } from './keys.ts';
import type { UsagePeriod } from './period.ts';

export const USAGE_WARNING_EVENT = 'usage.warning';

/** Stable within one period, different across periods. */
export function usageWarningDedupeKey(key: UsageKey, period: UsagePeriod): string {
  return `${USAGE_WARNING_EVENT}:${key}:${period.start.toISOString()}`;
}

export interface UsageWarningCopy {
  title: string;
  body: string;
}

/** Owner copy for the AI budget notice; `exceeded` once spend has reached the budget. */
export function usageWarningCopy({ level }: { level: 'warning' | 'exceeded' }): UsageWarningCopy {
  if (level === 'exceeded') {
    return {
      title: "You have used this month's AI budget",
      body: 'New AI processing is paused until your budget resets next month. Existing work is not affected.',
    };
  }
  return {
    title: "You have used 80% of this month's AI budget",
    body: "You have used 80% of this month's AI processing budget. Existing work is not affected.",
  };
}
