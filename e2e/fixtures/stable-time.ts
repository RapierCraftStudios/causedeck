// Stable time for visual baselines (#1156). `clock.freeze()` pins the browser only; the server
// renders its own clock (the weekly pulse card, audit and activity times). These helpers make that
// text deterministic without a server clock override:
//   - `disablePrompts`: switch the weekly check-in off for a member, so the Today card is absent on
//     any weekday (load-pulse.ts gates the card on `pov_prefs.prompts_enabled`);
//   - `pinText`: give server-rendered date/time elements fixed text after hydration;
//   - `settleFonts`: wait for `document.fonts.ready`, bounded, never throwing.
import type { Locator } from '@playwright/test';
import postgres from 'postgres';

import { databaseUrl } from '../support/db-reset.ts';

import { FROZEN_TIME } from './clock.ts';
import { e2eUser, type E2eRole } from './workspace.ts';

/** Insert `pov_prefs` (prompts_enabled = false) for the role's member in the workspace. */
export async function disablePrompts(
  database: string,
  role: E2eRole = 'owner',
  slug: string = 'chennai-solo',
): Promise<void> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    await sql`
      insert into pov_prefs (workspace_id, member_id, prompts_enabled)
      select o.id, m.id, false
        from organization o
        join member m on m.workspace_id = o.id
        join "user" u on u.id = m.user_id
       where o.slug = ${slug} and u.email = ${e2eUser(role).email}
      on conflict (workspace_id, member_id) do update set prompts_enabled = false`;
  } finally {
    await sql.end();
  }
}

/** Fixed text for a server-rendered time: a string, or `Intl` options applied to FROZEN_TIME. */
export type PinnedText = string | { locale?: string; options: Intl.DateTimeFormatOptions };

/** Replace the text of every element the locator matches, so its width does not depend on the run. */
export async function pinText(locator: Locator, text: PinnedText): Promise<void> {
  const value =
    typeof text === 'string'
      ? text
      : new Intl.DateTimeFormat(text.locale ?? 'en-IN', {
          timeZone: 'Asia/Kolkata',
          ...text.options,
        }).format(new Date(FROZEN_TIME));
  await locator.evaluateAll((nodes, v) => {
    for (const node of nodes) {
      node.textContent = v;
    }
  }, value);
}

/** The part of a Playwright `Page` that `settleFonts` uses. */
export interface FontPage {
  evaluate: (fn: (ms: number) => Promise<boolean>, arg: number) => Promise<boolean>;
}

/** Wait for `document.fonts.ready`, at most `timeoutMs`; a stuck font never fails or hangs a test. */
export async function settleFonts(page: FontPage, timeoutMs: number = 5000): Promise<boolean> {
  try {
    return await page.evaluate(
      (ms) =>
        Promise.race([
          document.fonts.ready.then(() => true),
          new Promise<boolean>((resolve) =>
            setTimeout(() => {
              resolve(false);
            }, ms),
          ),
        ]),
      timeoutMs,
    );
  } catch {
    return false;
  }
}
