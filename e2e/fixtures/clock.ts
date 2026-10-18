// Frozen time (#16): `clock.freeze()` pins `Date` and timers to 2026-03-12 09:30 IST via
// `page.clock`, so dates and relative times render identically on every run. Tests tagged
// `@visual` are frozen automatically before the first navigation (fixtures/index.ts).
import { test as base } from '@playwright/test';

export const FROZEN_TIME = '2026-03-12T09:30:00+05:30';

export interface Clock {
  /** Pin the page clock to `at` (default FROZEN_TIME). Call before `page.goto`. */
  freeze: (at?: string) => Promise<void>;
}

export const test = base.extend<{ clock: Clock }>({
  clock: async ({ page }, use) => {
    await use({
      freeze: async (at = FROZEN_TIME) => {
        await page.clock.setFixedTime(new Date(at));
      },
    });
  },
});
