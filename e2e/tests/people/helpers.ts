// Shared set-up for the People specs (#849, #82 part 3). The contacts are seeded per spec through
// `seedContacts` (superuser connection, like `emptyMatters`), so the template database and the
// matters fixtures stay as they are. The workspace is the matters one (`chennai-solo`).
import type { Locator, Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { COURTS_WORKSPACE_ID } from '../../fixtures/courts-data.ts';
import { MATTERS, MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { expect, type E2eRole } from '../../fixtures/index.ts';
import { withSql } from '../lifecycle/helpers.ts';
import { shellReady } from '../shell/helpers.ts';

export interface ContactFixture {
  id: string;
  personId: string;
  name: string;
  kind: 'primary' | 'instructing' | 'accounts' | 'family';
  language: 'en' | 'hi' | 'ta' | 'kn';
  phone: string | null;
  email: string | null;
  /** Linked to the appeal matter through an `instructed_by` role edge. */
  linked: boolean;
}

export const CONTACTS = {
  linked: {
    id: '00000000-0000-4000-8000-0000000c0a01',
    personId: '00000000-0000-4000-8000-0000000c0b01',
    name: 'Ilango Murugesan',
    kind: 'primary',
    language: 'ta',
    phone: '+919840000001',
    email: 'ilango.contact@example.e2e.test',
    linked: true,
  },
  unlinked: {
    id: '00000000-0000-4000-8000-0000000c0a02',
    personId: '00000000-0000-4000-8000-0000000c0b02',
    name: 'Fictional Trading Co',
    kind: 'accounts',
    language: 'en',
    phone: null,
    email: 'accounts@example.e2e.test',
    linked: false,
  },
  tamil: {
    id: '00000000-0000-4000-8000-0000000c0a03',
    personId: '00000000-0000-4000-8000-0000000c0b03',
    name: 'முருகன் இளங்கோவன்',
    kind: 'family',
    language: 'ta',
    phone: '+919840000003',
    email: null,
    linked: false,
  },
  kannada: {
    id: '00000000-0000-4000-8000-0000000c0a04',
    personId: '00000000-0000-4000-8000-0000000c0b04',
    name: 'ಕಾವೇರಿ ಗೌಡ',
    kind: 'primary',
    language: 'kn',
    phone: '+919840000004',
    email: null,
    linked: false,
  },
} as const satisfies Record<string, ContactFixture>;

export const ALL_CONTACTS: readonly ContactFixture[] = Object.values(CONTACTS);

/** `people[/<id>][?query]`, relative to the workspace. */
export function peoplePath(id?: string, query = ''): string {
  const base = id === undefined ? 'people' : `people/${id}`;
  return query === '' ? base : `${base}?${query}`;
}

/** Remove every contact of the fixture workspace (and the persons this spec seeded). */
export function emptyContacts(database: string): Promise<void> {
  return withSql(database, async (sql) => {
    const ws = COURTS_WORKSPACE_ID;
    await sql`delete from client_contact where workspace_id = ${ws}`;
    await sql`delete from role_edge where workspace_id = ${ws}
      and from_person_id in ${sql(ALL_CONTACTS.map((c) => c.personId))}`;
    await sql`delete from person where workspace_id = ${ws}
      and id in ${sql(ALL_CONTACTS.map((c) => c.personId))}`;
  });
}

/**
 * Seed the four contacts: one linked to the appeal matter, three not (created two days ago, so the
 * `Not linked` flag shows). Idempotent.
 */
export async function seedContacts(database: string): Promise<void> {
  await emptyContacts(database);
  await withSql(database, async (sql) => {
    const ws = COURTS_WORKSPACE_ID;
    for (const c of ALL_CONTACTS) {
      await sql`
        insert into person (id, workspace_id, name, aliases, kind, source_type, confirmation_state)
        values (${c.personId}, ${ws}, ${c.name}, ${[] as string[]}::text[], 'client', 'manual',
                'confirmed')`;
      await sql`
        insert into client_contact (id, workspace_id, person_id, kind, phone, email, language_pref,
          created_at, updated_at)
        values (${c.id}, ${ws}, ${c.personId}, ${c.kind}, ${c.phone}, ${c.email}, ${c.language},
                now() - interval '2 days', now() - interval '2 days')`;
      if (c.linked) {
        await sql`
          insert into role_edge (workspace_id, kind, from_person_id, matter_id, source_type,
            confirmation_state)
          values (${ws}, 'instructed_by', ${c.personId}, ${MATTERS.appeal.id}, 'manual',
                  'confirmed')`;
      }
    }
  });
}

/** Sign in as `role` of the fixture workspace and open a People page, hydrated. */
export async function openPeople(
  page: Page,
  asUser: AsUser,
  { role = 'owner', path = peoplePath() }: { role?: E2eRole; path?: string } = {},
): Promise<void> {
  await asUser(role, { workspace: MATTERS_WORKSPACE, path });
  await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
  await shellReady(page);
}

/** The visible row of a contact on the list. */
export function contactRow(page: Page, contact: ContactFixture): Locator {
  return page.locator(`a[data-contact-row="${contact.id}"]`);
}

/** Mask for screenshots: nothing on the People pages follows the real clock. */
export function volatile(page: Page): Locator[] {
  return [page.locator('[data-contact-log] time')];
}
