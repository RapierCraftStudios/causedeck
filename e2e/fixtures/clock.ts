// Frozen browser time (#16): `clock.freeze()` pins `Date` and timers in the page to 2026-03-12 09:30
// IST via `page.clock`. It does not touch the server: text the server renders from its own clock
// (the weekly pulse card, audit and activity times) is pinned with fixtures/stable-time.ts. Tests
// tagged `@visual`, and every `*.visual.spec.ts` file, are frozen automatically before the first
// navigation (fixtures/index.ts).
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
