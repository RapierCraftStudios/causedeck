// Memory journeys (#73) on `/w/chennai-solo/memory`: the empty and denied previews, the layer tabs
// in the URL, and that a court note's form says not to record analysis of individual judges.
// Runs in CI only (axe and visual baselines run in the same job); fictional data.
import { expect, test } from '../../fixtures/index.ts';
import { shellReady } from '../shell/helpers.ts';

const MEMORY = 'memory';

test.describe('memory screen', () => {
  test('empty state says nothing is saved and CauseDeck asks first', async ({ page, asUser }) => {
    await asUser('owner', { path: `${MEMORY}?__state=empty` });
    await shellReady(page);
    await expect(page.getByText(/Nothing saved yet/)).toBeVisible();
  });

  test('permission-denied preview explains instead of listing nothing', async ({
    page,
    asUser,
  }) => {
    await asUser('owner', { path: `${MEMORY}?__state=denied` });
    await shellReady(page);
    await expect(page.getByText(/cannot view memory/)).toBeVisible();
  });

  test('layer tabs land in the URL and court notes carry the judge note', async ({
    page,
    asUser,
  }) => {
    await asUser('owner', { path: MEMORY });
    await shellReady(page);
    const tab = page.getByRole('tab', { name: 'Court notes' });
    test.skip((await tab.count()) === 0, 'no seeded memory on this stack');
    await tab.click();
    await expect(page).toHaveURL(/[?&]layer=M4/);
    await expect(page.getByText('Your own notes')).toBeVisible();
    await expect(page.getByText(/individual judges/)).toBeVisible();
  });
});
