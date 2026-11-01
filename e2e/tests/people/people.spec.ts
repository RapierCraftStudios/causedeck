// People contacts product spec (#849, #82 part 3): the create flow, search and filters, the detail
// page, the states (empty, loading, error with retry, denied, offline, read-only) and the keyboard
// (n, /, j, Enter, Esc). Contacts are seeded per test (helpers.ts); the database is reset between
// tests.
import { MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { streamSettled } from '../shell/helpers.ts';

import {
  CONTACTS,
  contactRow,
  emptyContacts,
  openPeople,
  peoplePath,
  seedContacts,
} from './helpers.ts';

const url = (path: string) => `/w/${MATTERS_WORKSPACE}/${path}`;

test.describe('people contacts', () => {
  test('list: every contact, with kind, language, links and the unlinked flag', async ({
    page,
    asUser,
    db,
  }) => {
    await seedContacts(db.name);
    await openPeople(page, asUser);
    await expect(page.locator('a[data-contact-row]')).toHaveCount(4);
    const linked = contactRow(page, CONTACTS.linked);
    await expect(linked).toContainText('Ilango Murugesan');
    await expect(linked).toContainText('Tamil');
    await expect(linked.locator('[data-contact-linked]')).toHaveText('1 linked matter');
    await expect(linked.locator('[data-contact-unlinked]')).toHaveCount(0);
    const unlinked = contactRow(page, CONTACTS.unlinked);
    await expect(unlinked.locator('[data-contact-unlinked]')).toHaveText('Not linked to a matter');
    await expect(contactRow(page, CONTACTS.tamil)).toContainText(CONTACTS.tamil.name);
    await expect(contactRow(page, CONTACTS.kannada)).toContainText(CONTACTS.kannada.name);
  });

  test('flow: create a contact, find it, open it and see its details', async ({
    page,
    asUser,
    db,
  }) => {
    await seedContacts(db.name);
    await openPeople(page, asUser);
    await page.locator('[data-slot="new-contact"]').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Save contact' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.locator('[data-contact-field="client"]').fill(CONTACTS.linked.name);
    await dialog.locator('[data-contact-field="email"]').fill('new.contact@example.e2e.test');
    await dialog.locator('[data-contact-field="language"]').selectOption('hi');
    await dialog.getByRole('button', { name: 'Save contact' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('new.contact@example.e2e.test')).toBeVisible();

    await page.goto(url(peoplePath(undefined, 'q=new.contact')));
    const row = page.locator('a[data-contact-row]');
    await expect(row).toHaveCount(1);
    await row.click();
    await expect(page.locator('[data-route="people-detail"]')).toBeVisible();
    await expect(page.locator('[data-contact-language="hi"]')).toHaveText('Hindi');
    await expect(page.locator('[data-linked-matters]')).toBeVisible();
    await expect(page.locator('[data-contact-log]').first()).toBeVisible();
  });

  test('search and filters narrow the list; a filter with no match offers to clear it', async ({
    page,
    asUser,
    db,
  }) => {
    await seedContacts(db.name);
    await openPeople(page, asUser);
    await page.getByRole('searchbox', { name: 'Search contacts' }).fill('Fictional');
    await page.getByRole('searchbox', { name: 'Search contacts' }).press('Enter');
    await expect(page).toHaveURL(/q=Fictional/);
    await expect(page.locator('a[data-contact-row]')).toHaveCount(1);

    await page.goto(url(peoplePath(undefined, 'language=kn')));
    await expect(page.locator('a[data-contact-row]')).toHaveCount(1);
    await expect(contactRow(page, CONTACTS.kannada)).toBeVisible();

    await page.goto(url(peoplePath(undefined, 'kind=accounts&language=kn')));
    const empty = page.locator('[data-contacts-empty="filtered"]');
    await expect(empty).toBeVisible();
    await empty.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page.locator('a[data-contact-row]')).toHaveCount(4);
  });

  test('detail: a contact linked to a matter lists it; an unlinked one says so', async ({
    page,
    asUser,
    db,
  }) => {
    await seedContacts(db.name);
    await openPeople(page, asUser, { path: peoplePath(CONTACTS.linked.id) });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(CONTACTS.linked.name);
    await expect(page.locator('[data-linked-matters="list"] a')).toHaveCount(1);
    await page.goto(url(peoplePath(CONTACTS.unlinked.id)));
    await streamSettled(page);
    await expect(page.locator('[data-linked-matters="empty"]')).toBeVisible();
  });

  test('states: empty', async ({ page, asUser, db }) => {
    await emptyContacts(db.name);
    await openPeople(page, asUser);
    await expect(page.locator('main [data-pattern-state="empty"]')).toBeVisible();
    await expect(page.getByText('No contacts yet')).toBeVisible();
  });

  test('states: loading, error with retry and denied', async ({ page, asUser, db }) => {
    await seedContacts(db.name);
    await openPeople(page, asUser);
    await page.goto(url(peoplePath(undefined, '__state=loading')));
    await expect(page.locator('main [data-pattern-state="loading"]')).toBeVisible();

    await page.goto(url(peoplePath(undefined, '__state=error')));
    const error = page.locator('main [data-pattern-state="error"]');
    await expect(error).toBeVisible({ timeout: 15_000 });
    await expect(error.getByRole('button', { name: 'Retry' })).toBeVisible();

    await page.goto(url(peoplePath(undefined, '__state=denied')));
    await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveText('No access');
  });

  test('states: offline disables New contact and shows the banner', async ({
    page,
    asUser,
    db,
  }) => {
    await seedContacts(db.name);
    await openPeople(page, asUser);
    await page.context().setOffline(true);
    await expect(page.locator('[data-contacts-offline]')).toBeVisible();
    await expect(page.locator('[data-slot="new-contact"]').first()).toBeDisabled();
    await page.context().setOffline(false);
    await expect(page.locator('[data-contacts-offline]')).toBeHidden();
  });

  test('read-only role: contacts are listed and there is no New contact button', async ({
    page,
    asUser,
    db,
  }) => {
    await seedContacts(db.name);
    await openPeople(page, asUser, { role: 'viewer' });
    await expect(page.locator('a[data-contact-row]').first()).toBeVisible();
    await expect(page.locator('[data-slot="new-contact"]')).toHaveCount(0);
  });

  test('keyboard: / focuses search, n opens the form, Esc closes it, j and Enter open a row', async ({
    page,
    asUser,
    db,
  }) => {
    await seedContacts(db.name);
    await openPeople(page, asUser);
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox', { name: 'Search contacts' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('searchbox', { name: 'Search contacts' })).not.toBeFocused();

    await page.keyboard.press('n');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.keyboard.press('j');
    const first = page.locator('a[data-contact-row]').first();
    await expect(first).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-route="people-detail"]')).toBeVisible();
  });
});
