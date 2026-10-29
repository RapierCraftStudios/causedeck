// People accessibility (#849, #82 part 3): zero serious or critical axe violations on every People
// state in every viewport and theme project (360/768/1280, light and dark). `@a11y`: the fixture
// runs axe on the page each test ends on (fixtures/index.ts), so each test ends on the state it
// names. Focus order and non-colour status are asserted in the same tests.
import { MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { expect, test } from '../../fixtures/index.ts';

import {
  CONTACTS,
  contactRow,
  emptyContacts,
  openPeople,
  peoplePath,
  seedContacts,
} from './helpers.ts';

const url = (path: string) => `/w/${MATTERS_WORKSPACE}/${path}`;

test.describe('people accessibility', { tag: '@a11y' }, () => {
  test('list', async ({ page, asUser, db }) => {
    await seedContacts(db.name);
    await openPeople(page, asUser);
    await expect(page.locator('a[data-contact-row]').first()).toBeVisible();
  });

  test('list: focus follows the visual order (search, then the rows)', async ({
    page,
    asUser,
    db,
  }) => {
    await seedContacts(db.name);
    await openPeople(page, asUser);
    const order = await page.evaluate(() => {
      const search = document.querySelector('input[type="search"]');
      const row = document.querySelector('a[data-contact-row]');
      if (!search || !row) return null;
      return search.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    expect(order).toBeTruthy();
  });

  test('list: the unlinked flag carries its words, not colour alone', async ({
    page,
    asUser,
    db,
  }) => {
    await seedContacts(db.name);
    await openPeople(page, asUser);
    await expect(contactRow(page, CONTACTS.unlinked).locator('[data-contact-unlinked]')).toHaveText(
      'Not linked to a matter',
    );
  });

  test('list: the new contact dialog', async ({ page, asUser, db }) => {
    await seedContacts(db.name);
    await openPeople(page, asUser);
    await page.locator('[data-slot="new-contact"]').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('list: the new contact dialog with a validation error', async ({ page, asUser, db }) => {
    await seedContacts(db.name);
    await openPeople(page, asUser);
    await page.locator('[data-slot="new-contact"]').first().click();
    await page.getByRole('button', { name: 'Save contact' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('list: empty', async ({ page, asUser, db }) => {
    await emptyContacts(db.name);
    await openPeople(page, asUser);
    await expect(page.locator('main [data-pattern-state="empty"]')).toBeVisible();
  });

  test('list: filtered empty', async ({ page, asUser, db }) => {
    await seedContacts(db.name);
    await openPeople(page, asUser, { path: peoplePath(undefined, 'q=zzzz') });
    await expect(page.locator('[data-contacts-empty="filtered"]')).toBeVisible();
  });

  test('list: error', async ({ page, asUser, db }) => {
    await seedContacts(db.name);
    await openPeople(page, asUser);
    await page.goto(url(peoplePath(undefined, '__state=error')));
    await expect(page.locator('main [data-pattern-state="error"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('detail: linked contact', async ({ page, asUser, db }) => {
    await seedContacts(db.name);
    await openPeople(page, asUser, { path: peoplePath(CONTACTS.linked.id) });
    await expect(page.locator('[data-linked-matters="list"]')).toBeVisible();
  });

  test('detail: unlinked contact', async ({ page, asUser, db }) => {
    await seedContacts(db.name);
    await openPeople(page, asUser, { path: peoplePath(CONTACTS.unlinked.id) });
    await expect(page.locator('[data-linked-matters="empty"]')).toBeVisible();
  });

  test('detail: Tamil and Kannada names', async ({ page, asUser, db }) => {
    await seedContacts(db.name);
    await openPeople(page, asUser, { path: peoplePath(CONTACTS.tamil.id) });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(CONTACTS.tamil.name);
    await page.goto(url(peoplePath(CONTACTS.kannada.id)));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(CONTACTS.kannada.name);
  });
});
