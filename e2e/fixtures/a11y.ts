// axe-core assertions (#16): `a11y.expectNoViolations(page)` fails on any serious or critical
// violation and lists every offending node. Tests tagged `@a11y` run it automatically after the
// test body (fixtures/index.ts).
import { AxeBuilder } from '@axe-core/playwright';
import { test as base, type Page } from '@playwright/test';

export type Impact = 'minor' | 'moderate' | 'serious' | 'critical';

export interface ExpectNoViolationsOptions {
  /** Impacts that fail the assertion. Default: serious and critical. */
  impact?: readonly Impact[];
  /** CSS selectors to leave out (e.g. third-party widgets). */
  exclude?: readonly string[];
}

export interface A11y {
  expectNoViolations: (page: Page, options?: ExpectNoViolationsOptions) => Promise<void>;
}

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export async function expectNoViolations(
  page: Page,
  { impact = ['serious', 'critical'], exclude = [] }: ExpectNoViolationsOptions = {},
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  for (const selector of exclude) builder = builder.exclude(selector);
  const { violations } = await builder.analyze();
  const failing = violations.filter((v) => v.impact && impact.includes(v.impact));
  if (failing.length === 0) return;
  const report = failing
    .map((v) => {
      const nodes = v.nodes
        .map(
          (n) =>
            `    - ${n.target.join(' ')}\n      ${n.failureSummary?.replace(/\n/g, '\n      ') ?? ''}`,
        )
        .join('\n');
      return `  [${v.impact ?? 'unknown'}] ${v.id}: ${v.help} (${v.helpUrl})\n${nodes}`;
    })
    .join('\n');
  throw new Error(
    `axe: ${String(failing.length)} ${impact.join('/')} violation(s) on ${page.url()}\n${report}`,
  );
}

export interface A11yFixtures {
  a11y: A11y;
  /** Options for the automatic `@a11y` check; set per file with `test.use({ a11yOptions })`. */
  a11yOptions: ExpectNoViolationsOptions;
}

export const test = base.extend<A11yFixtures>({
  a11yOptions: [{}, { option: true }],
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure.
  a11y: async ({}, use) => {
    await use({ expectNoViolations });
  },
});
