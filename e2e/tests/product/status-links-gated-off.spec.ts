// With `status_links.enabled` off (the default) the authoring control is absent and every token is
// a 404 (#88). Written for CI; not run locally.
import { expect, test } from '../../fixtures/index.ts';
import { MATTERS, MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { contentReady } from '../shell/helpers.ts';

test.describe('status links gated off', () => {
  test('no Share a status link control on the matter page', async ({ page, asUser }) => {
    await asUser('owner', { workspace: MATTERS_WORKSPACE, path: `matters/${MATTERS.appeal.id}` });
    await contentReady(page);
    await expect(page.getByRole('button', { name: 'Share a status link' })).toHaveCount(0);
  });

  test('/s/<token> is a 404', async ({ page }) => {
    const response = await page.goto('/s/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(response?.status()).toBe(404);
  });
});
