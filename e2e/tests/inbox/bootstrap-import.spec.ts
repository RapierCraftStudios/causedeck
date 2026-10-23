// Bootstrap import (#552, #57 part 6) on `/w/<shell workspace>/import`: a viewer is denied, the
// empty state teaches what the import does, bulk import is opt-in, and the 201st file is refused
// with a clear message. Files are only selected, never uploaded (the channel is off and the e2e
// stack has no job worker). Fictional data only.
import { expect, test } from '../../fixtures/index.ts';
import { contentReady } from '../shell/helpers.ts';

const IMPORT_PATH = 'import';

test.describe('bootstrap import', () => {
  test('a viewer is denied', async ({ page, asUser }) => {
    await asUser('viewer', { path: IMPORT_PATH });
    await expect(
      page.getByText('You need permission to add matters to import files.'),
    ).toBeVisible();
  });

  test(
    'the empty state explains the import and the channel is opt-in',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await asUser('owner', { path: IMPORT_PATH });
      await contentReady(page);
      await expect(page.getByText('Bring your existing cases in')).toBeVisible();
      await expect(page.getByText('Turn on bulk import first')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Turn on bulk import' })).toBeVisible();
    },
  );

  test('refuses the 201st file with a message', async ({ page, asUser }) => {
    await asUser('owner', { path: IMPORT_PATH });
    await contentReady(page);
    const files = Array.from({ length: 201 }, (_, n) => ({
      name: `list-${String(n)}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from(`cause list ${String(n)}`),
    }));
    await page.getByTestId('import-file-input').setInputFiles(files);
    await expect(
      page.getByText('Only 200 files can be imported at a time. 1 file was not added.'),
    ).toBeVisible();
    await expect(page.getByText('200 files of 200')).toBeVisible();
  });
});
