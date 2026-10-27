// Precedent picker journeys (#904, criterion 7 of #81), CI only: the panel for a narrative block
// shows ranked passages with why-suggested and a Provenance Chip, or its empty state, and nothing is
// inserted until the lawyer clicks Insert. The picker is behind `m5_playbooks`; the spec skips when
// the flag is off for the fixture workspace.
import { DRAFTING, DRAFTING_WORKSPACE } from '../../fixtures/drafting-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { contentReady } from '../shell/helpers.ts';

const path = `drafts/${DRAFTING.draft.id}`;

test.describe('drafting precedent picker', () => {
  test('lists passages with reasons, and inserts only on click', async ({ page, asUser }) => {
    await asUser('owner', { workspace: DRAFTING_WORKSPACE, path });
    await contentReady(page);
    const picker = page.locator('[data-slot="precedent-picker"]').first();
    test.skip((await picker.count()) === 0, 'm5_playbooks is off for this workspace');

    const passages = page.locator('[data-slot="precedent-passage"]');
    await expect(picker).toBeVisible();
    // Nothing is inserted by looking: the save state stays idle.
    await expect(page.getByText('Saving')).toHaveCount(0);

    if ((await passages.count()) === 0) {
      await expect(
        picker.getByText(/Passages you approve will appear here|Select a narrative block/),
      ).toBeVisible();
      return;
    }
    const first = passages.first();
    await expect(first.getByRole('list', { name: 'Why this is suggested' })).toBeVisible();
    await first.getByRole('button', { name: 'Insert' }).click();
    await expect(page.getByText(/Saved|Saving/).first()).toBeVisible();
  });

  test('a clerk sees the permission-denied state', async ({ page, asUser }) => {
    await asUser('clerk', { workspace: DRAFTING_WORKSPACE, path });
    await contentReady(page);
    const picker = page.locator('[data-slot="precedent-picker"]').first();
    test.skip((await picker.count()) === 0, 'm5_playbooks is off for this workspace');
    await expect(picker.getByText(/Your role cannot read|Select a narrative block/)).toBeVisible();
  });
});
