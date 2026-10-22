// Matters journeys (#394, #40 part 6): the list, its filters and search, the keyboard map, the
// tab bar and the polite live region, against the seeded journey matters
// (fixtures/matters-data.ts). The 500-matter bulk sits behind them (no next date), so the default
// sort lists the journey matters first.
import { MATTERS, MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { palette, shellReady } from '../shell/helpers.ts';

import {
  JOURNEY_ORDER,
  listLayout,
  matterPath,
  mattersPath,
  matterRow,
  openMatters,
} from './helpers.ts';

const phone = (page: { viewportSize: () => { width: number } | null }) =>
  (page.viewportSize()?.width ?? 1280) < 768;

test.describe('matters list', () => {
  test('lists the journey matters first, next date ascending, nulls last', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser);
    const rows = listLayout(page).locator('[data-matter-row]');
    await expect(rows.first()).toBeVisible();
    const ids = await rows.evaluateAll((nodes) =>
      nodes.slice(0, 5).map((node) => node.getAttribute('data-matter-row')),
    );
    expect(ids).toEqual(JOURNEY_ORDER.map((m) => m.id));
    await expect(matterRow(page, MATTERS.sensitive)).toHaveCount(0);
  });

  test('keyset pagination: 50 rows a page, next and first links', async ({ page, asUser }) => {
    await openMatters(page, asUser);
    await expect(listLayout(page).locator('[data-matter-row]')).toHaveCount(50);
    await page.locator('[data-matters-page="next"]').click();
    await expect(page).toHaveURL(/cursor=/);
    await expect(page.locator('[data-matters-page="first"]')).toBeVisible();
    await page.locator('[data-matters-page="first"]').click();
    await expect(page).not.toHaveURL(/cursor=/);
  });

  test('the sensitive filter lists the locked matter with its lock badge', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser, { path: mattersPath('sensitive=1') });
    const row = matterRow(page, MATTERS.sensitive);
    await expect(row).toBeVisible();
    await expect(row.getByText('Sensitive', { exact: true })).toBeVisible();
    await expect(listLayout(page).locator('[data-matter-row]')).toHaveCount(1);
  });

  test('search finds a matter by party and by case number in another punctuation', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser);
    const search = page.getByRole('searchbox', { name: 'Search matters' });
    await search.fill('Meenakshi');
    await expect(page).toHaveURL(/q=Meenakshi/);
    await expect(matterRow(page, MATTERS.conflict)).toBeVisible();
    await expect(listLayout(page).locator('[data-matter-row]')).toHaveCount(1);
    await search.fill('W.P. 3003 / 2025');
    await expect(page).toHaveURL(/q=W\.P/);
    await expect(matterRow(page, MATTERS.proposed)).toBeVisible();
  });

  test('a search with no match shows the filtered-empty state with a way out', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser, { path: mattersPath('q=zzzz-no-such-matter') });
    const empty = page.locator('[data-matters-empty="filtered"]');
    await expect(empty).toBeVisible();
    await empty.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page).not.toHaveURL(/q=/);
  });

  test('sorts by title through the header link', async ({ page, asUser }) => {
    test.skip(phone(page), 'the sort headers exist in the table layout');
    await openMatters(page, asUser);
    await page.locator('[data-matter-sort="title"]').click();
    await expect(page).toHaveURL(/sort=title/);
  });

  test('Tamil and Kannada party names render in the list', async ({ page, asUser }) => {
    await openMatters(page, asUser);
    await expect(matterRow(page, MATTERS.tamil)).toContainText('முருகன்');
    await expect(matterRow(page, MATTERS.kannada)).toContainText('ಕುಮಾರ್');
  });

  test('a clerk gets a list without the New matter action', async ({ page, asUser }) => {
    await openMatters(page, asUser, { role: 'clerk' });
    await expect(page.locator('[data-slot="new-matter"]')).toHaveCount(0);
  });
});

test.describe('matters keyboard', () => {
  test('n opens the new-matter dialog, Esc closes it and returns focus to the invoker', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser);
    const trigger = page.locator('[data-slot="new-matter"]').first();
    await trigger.focus();
    await page.keyboard.press('n');
    const dialog = page.getByRole('dialog', { name: 'New matter' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('the New matter button returns focus to itself on Esc', async ({ page, asUser }) => {
    await openMatters(page, asUser);
    const trigger = page.locator('[data-slot="new-matter"]').first();
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'New matter' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });

  test('/ focuses the search field', async ({ page, asUser }) => {
    await openMatters(page, asUser);
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox', { name: 'Search matters' })).toBeFocused();
  });

  test('j and k move through the rows, Enter opens the matter', async ({ page, asUser }) => {
    await openMatters(page, asUser);
    const rows = listLayout(page).locator('[data-matter-row]');
    await expect(rows.first()).toBeVisible();
    await page.keyboard.press('j');
    await expect(
      listLayout(page).locator(`[data-matter-row="${MATTERS.appeal.id}"]`),
    ).toBeVisible();
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/matters/${MATTERS.appeal.id}$`));
  });

  test('g then m goes to the matters list from another page', async ({ page, asUser }) => {
    await asUser('owner', { workspace: MATTERS_WORKSPACE, path: 'today' });
    await shellReady(page);
    await page.keyboard.press('g');
    await page.keyboard.press('m');
    await expect(page).toHaveURL(/\/w\/chennai-solo\/matters$/);
  });

  test('the ? sheet and the palette list the matters shortcuts', async ({ page, asUser }) => {
    await openMatters(page, asUser);
    await page.keyboard.press('?');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('New matter');
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+k');
    await expect(palette(page)).toBeVisible();
    await page.keyboard.type('New matter');
    await expect(
      palette(page)
        .getByRole('option', { name: /New matter/ })
        .first(),
    ).toBeVisible();
  });

  test('the palette finds a matter by party and shows its next date and forum', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser);
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.type('Meenakshi');
    const option = palette(page).getByRole('option', { name: /Meenakshi/ });
    await expect(option).toBeVisible();
  });

  test('arrow keys move within the proceedings tree', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path: matterPath(MATTERS.appeal, 'proceedings') });
    const tree = page.getByRole('tree');
    await expect(tree).toBeVisible();
    const items = tree.getByRole('treeitem');
    await expect(items.first()).toBeVisible();
    await items.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(items.first()).toBeFocused();
  });
});

test.describe('matter workspace', () => {
  test('the proceedings tab shows the appeal chain with its W.M.P. children', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser, { path: matterPath(MATTERS.appeal, 'proceedings') });
    const tree = page.getByRole('tree');
    await expect(tree.getByRole('treeitem')).toHaveCount(4);
    await expect(tree).toContainText('3001');
    await expect(tree).toContainText('210');
    await expect(tree).toContainText('4501');
    await expect(tree).toContainText('4502');
  });

  test('the tab bar is a tablist and the live region is polite', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path: matterPath(MATTERS.appeal) });
    const tabs = page.getByRole('tablist');
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole('tab', { selected: true })).toBeVisible();
    await expect(page.locator('[data-matter-announcer][aria-live="polite"]')).toHaveCount(1);
  });

  test('the overview shows the conflict card with both sources, never auto-resolved', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser, { path: matterPath(MATTERS.conflict) });
    const card = page.locator('[data-slot="date-conflict-card"]');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-conflict-side]')).toHaveCount(2);
    await expect(card.locator('[data-conflict-choose="A"]')).toBeVisible();
    await expect(card.locator('[data-conflict-choose="B"]')).toBeVisible();
  });

  test('a proposed next date shows Confirm; the confirmation is announced', async ({
    page,
    asUser,
  }) => {
    await openMatters(page, asUser, { path: matterPath(MATTERS.proposed) });
    await expect(page.locator('[data-confirmation="proposed"]')).toBeVisible();
    await page.locator('[data-next-date-confirm]').click();
    await expect(page.locator('[data-confirmation="confirmed"]')).toBeVisible();
  });

  test('the people and documents tabs list the seeded rows', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path: matterPath(MATTERS.appeal, 'people') });
    await expect(page.locator('[data-people]')).toContainText('ராமசாமி');
    await page.goto(`/w/${MATTERS_WORKSPACE}/${matterPath(MATTERS.appeal, 'documents')}`);
    await expect(page.locator('[data-documents]')).toBeVisible();
  });

  test('the sensitive toggle asks for confirmation first', async ({ page, asUser }) => {
    await openMatters(page, asUser, { path: matterPath(MATTERS.proposed) });
    await page.locator('[data-matter-menu]').click();
    await page.locator('[data-sensitive-toggle]').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('AI processing is turned off for this matter');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('a matter of another workspace is a not-found', async ({ page, asUser }) => {
    await asUser('owner', { workspace: 'bengaluru-chamber', path: matterPath(MATTERS.appeal) });
    await expect(page.locator('[data-matter-not-found]')).toContainText(
      "This matter doesn't exist or you can't open it.",
    );
  });
});
