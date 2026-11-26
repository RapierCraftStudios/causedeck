// Day-independent visual shots (#1106). `page.clock` only moves the browser; the server renders its
// own real clock, so the weekly pulse card (due every day except Monday before 06:00 IST), the
// court-day date line and the feed times change with the day the suite runs. A mask hides those
// pixels but not the layout shift they cause, so `@visual` specs turn the pulse off with
// `disablePrompts` and give server-rendered times fixed text with `pinText`.
import type { Locator, Page } from '@playwright/test';
import postgres from 'postgres';

import { databaseUrl } from '../support/db-reset.ts';

import { FROZEN_TIME } from './clock.ts';
import { E2E_WORKSPACES, e2eUser, type E2eRole, type E2eWorkspaceSlug } from './workspace.ts';

/** A Monday and a Sunday morning (IST): the browser clocks a shot must look the same under. */
export const WEEKDAY_CLOCKS = {
  monday: '2026-11-02T09:30:00+05:30',
  sunday: '2026-11-01T09:30:00+05:30',
} as const;

/**
 * Turns the member's prompts off, so `dueForPulse` is false whatever day the server runs on
 * (packages/core/src/pov/load-pulse.ts) and the weekly check-in card is not on Today. Written as
 * the superuser, like the other e2e seeders; the database is reset before every test.
 */
export async function disablePrompts(
  database: string,
  role: E2eRole = 'owner',
  slug: E2eWorkspaceSlug = 'chennai-solo',
): Promise<void> {
  const workspaceId = E2E_WORKSPACES[slug].id;
  const userId = e2eUser(role, slug).id;
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    await sql`
      insert into pov_prefs (workspace_id, member_id, prompts_enabled)
      select ${workspaceId}::uuid, m.id, false
      from member m
      where m.workspace_id = ${workspaceId}::uuid and m.user_id = ${userId}::uuid
      on conflict (workspace_id, member_id) do update set prompts_enabled = false`;
  } finally {
    await sql.end();
  }
}

/**
 * Replaces the text of every match with fixed text, so its width and the layout around it stay the
 * same. A string is used as given; format options render the frozen instant in the page's
 * language (Tamil stays Tamil), so the script and glyph shaping are still part of the shot.
 * Call after the page has hydrated.
 */
export async function pinText(
  locator: Locator,
  text: string | Intl.DateTimeFormatOptions,
): Promise<void> {
  await locator.evaluateAll(
    (elements, { text: pinned, at }) => {
      const value =
        typeof pinned === 'string'
          ? pinned
          : new Intl.DateTimeFormat(document.documentElement.lang || 'en', pinned).format(
              new Date(at),
            );
      for (const element of elements) element.textContent = value;
    },
    { text, at: FROZEN_TIME },
  );
}

/** The court-day header date (`day-header.tsx`): weekday, day and month in IST. */
export const DAY_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Kolkata',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
};

/** Audit and activity feed times (`audit-feed.tsx`): medium date and short time in IST. */
export const FEED_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
};

/** Pins the court-day date line, the only server-day text on the Today shell. */
export function pinDayDate(page: Page): Promise<void> {
  return pinText(page.locator('[data-day-meta] time'), DAY_DATE_FORMAT);
}
