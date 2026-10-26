// Shared setup for the app shell suites (#159). The shell loads memberships from the database
// (#179): the seeded `chennai-solo` owner (packages/db/src/seed/e2e.ts) is also `clerk` of
// `bengaluru-chamber`, and owns the soft-deleted `mysuru-archived`, which never shows.
import type { Locator, Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';

/** The signed-in owner's own workspace. */
export const SHELL_WORKSPACE = 'chennai-solo';
/** The owner's second membership, held as `clerk`: the switch target and the permission check. */
export const CLERK_WORKSPACE = 'bengaluru-chamber';

/**
 * Placeholder routes an owner sees with flags off (apps/web/lib/nav.ts `WORKSPACE_ROUTES`, minus
 * the flag-gated `invoices` and `limitation`, and `billing` and `activity`, real pages since #256
 * and #232 with their own specs in tests/billing and tests/activity, and `courts`, a real page since
 * #399 with its own states in tests/courts, #425, and `inbox`, a real page since #48 with its own
 * specs in tests/inbox, and `drafts`, a real page since #736 with its own specs in
 * tests/product/outward-drafts). `settings` redirects to its profile section since
 * #284 (tests/settings).
 */
export const PLACEHOLDER_ROUTES = [
  // `today` and `tomorrow` are the Court-Day Board (#59) and `calendar` is real (#66): their
  // states are covered in tests/product/court-day-board.spec.ts and tests/calendar.
  // `matters` is a real page since #388 (its own states are covered in tests/matters).
  'briefs',
  'obligations',
  'memory',
  'people',
  'insights',
] as const;

export type PlaceholderRoute = (typeof PLACEHOLDER_ROUTES)[number];

/** Routes behind a flag that ships dark: they 404 for everyone. */
export const FLAG_GATED_ROUTES = ['invoices', 'limitation'] as const;

/**
 * `clerk` lacks `insights.read`: it renders the shell permission-denied page. Billing (also denied)
 * has its own owners-only copy since #256 (tests/billing).
 */
export const CLERK_DENIED_ROUTES = ['insights'] as const;

/** Layout tier of the project's viewport: phone below 768 px, rail to 1280 px, then desktop. */
export type Layout = 'phone' | 'rail' | 'desktop';

export function layoutOf(page: Page): Layout {
  const width = page.viewportSize()?.width ?? 1280;
  if (width < 768) return 'phone';
  if (width < 1280) return 'rail';
  return 'desktop';
}

/**
 * Wait until the shell has hydrated and its idle chunk (Radix overlays, animated nav indicator)
 * has arrived, so key presses and clicks reach the final components.
 */
export async function shellReady(page: Page): Promise<void> {
  await page.locator('[data-active-indicator="animated"]').waitFor({ state: 'attached' });
}

/**
 * Wait until React has hydrated the page's `main`, for routes that have no nav item (so no animated
 * active indicator to wait on, see `shellReady`), such as `/import`. Interactions that rely on event
 * handlers (file inputs, key presses) need it; assertions on visible text do not.
 */
export async function contentReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const main = document.querySelector('main');
    return main !== null && Object.keys(main).some((key) => key.startsWith('__reactFiber$'));
  });
}

export interface OpenShellOptions {
  workspace?: string;
  path?: string;
  /** Skip waiting for hydration (state pages, which have no active nav item to wait on). */
  wait?: boolean;
}

/** Sign in as the `chennai-solo` owner and open `/w/<workspace>/<path>` (default its Today). */
export async function openShell(
  page: Page,
  asUser: AsUser,
  { workspace = SHELL_WORKSPACE, path = 'today', wait = true }: OpenShellOptions = {},
): Promise<void> {
  await asUser('owner');
  await page.goto(`/w/${workspace}/${path}`);
  if (wait) await shellReady(page);
}

/** The sidebar `<aside>` (hidden below 768 px). */
export function sidebar(page: Page): Locator {
  return page.locator('#shell-sidebar');
}

/** The shell grid root, carrying `data-sidebar` and `data-reduced-motion`. */
export function shellRoot(page: Page): Locator {
  return page.locator('[data-shell]');
}

/** The command palette dialog. */
export function palette(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Command palette' });
}

/** The visible workspace switcher trigger: sidebar from 768 px, topbar on phones. */
export function switcherTrigger(page: Page): Locator {
  const variant = layoutOf(page) === 'phone' ? 'topbar' : 'sidebar';
  return page.locator(`[data-switcher-trigger="${variant}"]`);
}

/** The open switcher panel (sidebar popover or phone sheet), found by its listbox. */
export function switcherList(page: Page): Locator {
  return page.getByRole('listbox', { name: 'Workspaces' });
}

/** Computed durations of `element`, in milliseconds (the longest of a comma-separated list). */
export async function durationsMs(
  locator: Locator,
): Promise<{ transition: number; animation: number }> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const longest = (value: string) =>
      Math.max(
        0,
        ...value.split(',').map((part) => {
          const trimmed = part.trim();
          const number = Number.parseFloat(trimmed);
          if (Number.isNaN(number)) return 0;
          return trimmed.endsWith('ms') ? number : number * 1000;
        }),
      );
    return {
      transition: longest(style.transitionDuration),
      animation: style.animationName === 'none' ? 0 : longest(style.animationDuration),
    };
  });
}

/** Under reduced motion every motion token is 0.01 ms (packages/ui/tokens/motion.css). */
export const INSTANT_MS = 0.01;
