// The e2e `test` (#16): every spec imports `test`/`expect` from here, never from @playwright/test.
//   - `db` (auto): the worker database, reset from the template before each test;
//   - `asUser(role)`: a page signed in as that seeded role (dev sign-in provider);
//   - `a11y.expectNoViolations(page)`: axe, serious and critical; automatic after `@a11y` tests;
//   - `clock.freeze()`: page time pinned to 2026-03-12 09:30 IST; automatic for `@visual` tests;
//   - `adminAs(kind)` / `adminServer`: the staff console (#309), started only by specs that use it.
import { mergeTests } from '@playwright/test';

import { test as a11yTest } from './a11y.ts';
import { test as adminTest } from './admin.ts';
import { test as authTest } from './auth.ts';
import { test as clockTest } from './clock.ts';

export { expect } from '@playwright/test';
export { FROZEN_TIME } from './clock.ts';
export * from './workspace.ts';
export { ADMIN_FIXTURES, ALLOWED_HEADERS, totpCode, type AdminFixture } from './admin.ts';

const merged = mergeTests(authTest, a11yTest, clockTest, adminTest);

export const test = merged.extend<{ autoClock: undefined; autoA11y: undefined }>({
  // Freeze time before the test navigates, for every `@visual` test.
  autoClock: [
    async ({ clock }, use, testInfo) => {
      if (testInfo.tags.includes('@visual')) await clock.freeze();
      await use(undefined);
    },
    { auto: true },
  ],
  // The `@a11y` after-each: once the test body passed, assert no serious/critical axe violations
  // on the page it ended on. A skipped test never opened a page (it would be `about:blank`), so it
  // is left out; this matters now that the ship scope skips the phone-only specs at 1280 px.
  autoA11y: [
    async ({ page, a11y, a11yOptions }, use, testInfo) => {
      await use(undefined);
      if (
        testInfo.tags.includes('@a11y') &&
        testInfo.status !== 'skipped' &&
        testInfo.status === testInfo.expectedStatus
      ) {
        await a11y.expectNoViolations(page, a11yOptions);
      }
    },
    { auto: true },
  ],
});
