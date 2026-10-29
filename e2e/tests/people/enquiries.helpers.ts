// Helpers for the enquiry log specs (#875, #87 part 3). `intake.enquiry_log` is legal-gated: it is on
// only when the global and the workspace rows are both on and carry `legal_ack_by` and a note. The
// enquiries are fictional and seeded per test; the database is reset between tests.
import type { Locator, Page } from '@playwright/test';
import postgres from 'postgres';

import type { AsUser } from '../../fixtures/auth.ts';
import { COURTS_WORKSPACE_ID } from '../../fixtures/courts-data.ts';
import { MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { expect, type E2eRole } from '../../fixtures/index.ts';
import { databaseUrl } from '../../support/db-reset.ts';
import { withSql } from '../lifecycle/helpers.ts';
import { shellReady } from '../shell/helpers.ts';

export interface EnquiryFixture {
  id: string;
  name: string;
  status: 'logged' | 'checked' | 'declined';
  channel: 'phone' | 'email';
  summary: string;
}

export const ENQUIRIES = {
  logged: {
    id: '00000000-0000-4000-8000-0000000e0001',
    name: 'Asha Raman',
    status: 'logged',
    channel: 'phone',
    summary: 'Asks for help with a lease dispute.',
  },
  checked: {
    id: '00000000-0000-4000-8000-0000000e0002',
    name: 'Fictional Trading Co',
    status: 'checked',
    channel: 'email',
    summary: 'Wants advice on a supply contract.',
  },
  declined: {
    id: '00000000-0000-4000-8000-0000000e0003',
    name: 'Ravi Menon',
    status: 'declined',
    channel: 'phone',
    summary: 'Asks about a matter outside our practice area.',
  },
} as const satisfies Record<string, EnquiryFixture>;

const ALL: readonly EnquiryFixture[] = Object.values(ENQUIRIES);

/** `people/enquiries[?query]`, relative to the workspace. */
export function enquiriesPath(query = ''): string {
  return query === '' ? 'people/enquiries' : `people/enquiries?${query}`;
}

/** Turn `intake.enquiry_log` on for the fixture workspace (global and workspace rows, acknowledged). */
export async function enableEnquiryLog(database: string): Promise<void> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    await sql`
      insert into feature_flag (key, enabled, updated_by, legal_ack_by, legal_ack_note)
      select 'intake.enquiry_log', true, m.user_id, m.user_id,
             'e2e fixture: counsel sign-off recorded (fictional)'
        from member m
       where m.workspace_id = ${COURTS_WORKSPACE_ID} and m.role = 'owner'
       limit 1
      on conflict (key) do update set enabled = true, legal_ack_by = excluded.legal_ack_by,
        legal_ack_note = excluded.legal_ack_note`;
    await sql`
      insert into workspace_feature_flag
        (workspace_id, key, enabled, updated_by, legal_ack_by, legal_ack_note)
      select ${COURTS_WORKSPACE_ID}, 'intake.enquiry_log', true, m.user_id, m.user_id,
             'e2e fixture: counsel sign-off recorded (fictional)'
        from member m
       where m.workspace_id = ${COURTS_WORKSPACE_ID} and m.role = 'owner'
       limit 1
      on conflict do nothing`;
  } finally {
    await sql.end();
  }
}

/**
 * Drop the web server's flag cache. The worker's server outlives the per-test database reset, which
 * fires no `flag_changed`, so a flag an earlier spec turned on would still read as on for 15 s.
 */
export function dropFlagCache(database: string): Promise<void> {
  return withSql(database, async (sql) => {
    await sql`select pg_notify('flag_changed', 'intake.enquiry_log')`;
  });
}

/** Remove every enquiry of the fixture workspace (parties and check results go with them). */
export function emptyEnquiries(database: string): Promise<void> {
  return withSql(database, async (sql) => {
    await sql`delete from enquiry where workspace_id = ${COURTS_WORKSPACE_ID}`;
  });
}

/** Seed the three enquiries (logged, checked, declined), each with its client party. Idempotent. */
export async function seedEnquiries(database: string): Promise<void> {
  await emptyEnquiries(database);
  await withSql(database, async (sql) => {
    for (const e of ALL) {
      await sql`
        insert into enquiry (id, workspace_id, status, channel, enquirer_name, summary, received_at,
          closed_at, closed_reason)
        values (${e.id}, ${COURTS_WORKSPACE_ID}, ${e.status}, ${e.channel}, ${e.name}, ${e.summary},
                '2026-10-19T09:00:00Z', null, null)`;
      // A conflict check needs the parties to check; the enquirer is the client.
      await sql`
        insert into enquiry_party (enquiry_id, workspace_id, name, side)
        values (${e.id}, ${COURTS_WORKSPACE_ID}, ${e.name}, 'client')`;
    }
  });
}

/** Sign in as `role` of the fixture workspace and open the enquiry log, hydrated. */
export async function openEnquiries(
  page: Page,
  asUser: AsUser,
  { role = 'owner', path = enquiriesPath() }: { role?: E2eRole; path?: string } = {},
): Promise<void> {
  await asUser(role, { workspace: MATTERS_WORKSPACE, path });
  await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
  await shellReady(page);
}

/** The visible row of an enquiry. */
export function enquiryRow(page: Page, enquiry: EnquiryFixture): Locator {
  return page.locator(`[data-enquiry-row="${enquiry.id}"]`);
}

/** Mask for screenshots: nothing on the enquiry log follows the real clock. */
export function volatile(page: Page): Locator[] {
  return [page.locator('[data-enquiries-offline]')];
}
