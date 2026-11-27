// Judgment actions journey (#1176, part 3 of #1170), CI only (post-deploy check
// `judgment-actions-journey`): with `copilot.enabled` on, one masked judgment in the corpus and a
// draft on the matter, a Research result card carries the judgment actions; on the reader (cited
// paragraph) the lawyer copies the citation, saves the judgment to a new research note of the matter,
// inserts the cited passage into the draft (the server re-verifies it against the stored text) and
// opens the matter copilot with the judgment in context (chip + prefilled question). Fictional data
// only; the rows are removed after.
import { createHash, randomUUID } from 'node:crypto';

import { COURTS_WORKSPACE_ID } from '../../fixtures/courts-data.ts';
import { DRAFTING, DRAFTING_WORKSPACE } from '../../fixtures/drafting-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { MATTERS } from '../../fixtures/matters-data.ts';
import { e2eUser } from '../../fixtures/workspace.ts';
import { withSql } from '../lifecycle/helpers.ts';
import { contentReady } from '../shell/helpers.ts';

const CITATION = '2024 INSC 503';
const PARAGRAPH =
  '12. No written consent was taken from the patient before the appendectomy was performed.';
const BLOCKS = [
  { id: 'h1', type: 'heading', level: 1, text: 'Written submissions on consent' },
  { id: 'p1', type: 'paragraph', text: 'The plaintiff never gave written consent to surgery.' },
];

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.describe('judgment actions', () => {
  test('copy, save to matter, insert into draft and ask the copilot from a judgment', async ({
    page,
    asUser,
    db,
  }) => {
    const judgmentId = randomUUID();
    const draftId = randomUUID();
    const sha256 = createHash('sha256').update(`e2e-judgment-actions:${judgmentId}`).digest('hex');
    const pages = [
      { pageNo: 1, text: '11. The appellant is a nursing home.' },
      { pageNo: 2, text: PARAGRAPH },
    ];
    await withSql(db.name, async (sql) => {
      await sql`
        insert into feature_flag (key, enabled, updated_by)
        values ('copilot.enabled', true, ${e2eUser('owner').id})
        on conflict (key) do update set enabled = true`;
      const provenance = {
        url: `https://demo.causedeck.test/corpus/${judgmentId}`,
        fetchedAt: '2026-01-01T00:00:00.000Z',
        sha256,
        sourceId: 'demo.corpus',
        sourceVersion: 'v1',
        tierUsed: 'http',
        costDollars: 0,
      };
      await sql`
        insert into judgment (id, source_id, court, neutral_citation, judgment_date, sha256,
          provenance, page_text, redacted_text, redaction_version, segment_version,
          segmented_redaction_version, case_title, title_masked, court_level)
        values (${judgmentId}, 'demo.corpus', 'SC', ${CITATION}, '2024-03-04', ${sha256},
          ${sql.json(provenance)}, ${sql.json(pages)}, ${sql.json(pages)}, 2, 1, 2,
          'Q (fictional) v. Town Nursing Home', true, 'supreme_court')`;
      await sql`
        insert into judgment_segment (judgment_id, ordinal, role, page_from, page_to, text, court,
          court_level, judgment_year)
        values (${judgmentId}, 1, 'facts', 2, 2, ${PARAGRAPH}, 'SC', 'supreme_court', 2024)`;
      await sql`
        insert into draft (id, workspace_id, template_id, matter_id, title, status)
        values (${draftId}, ${COURTS_WORKSPACE_ID}, ${DRAFTING.template.id}, ${MATTERS.appeal.id},
                'Appendectomy submissions (fictional)', 'draft')`;
      await sql`
        insert into draft_version (workspace_id, draft_id, version_no, content, content_sha256)
        values (${COURTS_WORKSPACE_ID}, ${draftId}, 1, ${sql.json(BLOCKS)},
                ${createHash('sha256').update(JSON.stringify(BLOCKS)).digest('hex')})`;
    });
    try {
      await page.setViewportSize({ width: 1280, height: 900 });

      // A Research result card carries the judgment actions.
      await asUser('owner', { workspace: DRAFTING_WORKSPACE, path: 'research' });
      await contentReady(page);
      await page
        .getByLabel('Describe the facts or the point of law')
        .fill('written consent before appendectomy');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      const card = page
        .locator('[data-slot="authority-results-list"] li')
        .filter({ hasText: 'appendectomy' })
        .first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card.locator('[data-slot="judgment-actions"]')).toBeVisible();

      // The reader at the cited paragraph.
      await asUser('owner', {
        workspace: DRAFTING_WORKSPACE,
        path: `research/judgments/${judgmentId}?page=2&para=12`,
      });
      await contentReady(page);
      const actions = page.locator('[data-slot="reader-header"] [data-slot="judgment-actions"]');
      await expect(actions).toBeVisible();

      await actions.getByRole('button', { name: 'Copy citation' }).click();
      await expect(actions.getByText('Citation copied')).toBeVisible();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toContain(CITATION);
      expect(copied).toContain('para 12');

      // Save to a new research note on the matter.
      await actions.getByRole('button', { name: 'Save to matter' }).click();
      await actions.getByLabel('Matter').selectOption(MATTERS.appeal.id);
      await actions.getByLabel('Note').waitFor();
      await actions.locator('[data-slot="judgment-save-submit"]').click();
      await expect(actions.locator('[data-slot="judgment-saved"]')).toBeVisible({
        timeout: 15_000,
      });

      // Insert the cited passage into the draft; the server re-verifies it.
      await actions.getByRole('button', { name: 'Insert into draft' }).click();
      await actions.getByLabel('Matter').selectOption(MATTERS.appeal.id);
      await actions.getByLabel('Draft').selectOption({ label: 'Appendectomy submissions (fictional)' });
      await actions.getByLabel('After').selectOption('p1');
      await actions.locator('[data-slot="judgment-insert-submit"]').click();
      await expect(actions.locator('[data-slot="judgment-inserted"]')).toBeVisible({
        timeout: 15_000,
      });

      // Ask the copilot: the matter copilot opens with the judgment in context.
      await actions.getByRole('button', { name: 'Ask the copilot' }).click();
      await actions.getByLabel('Matter').selectOption(MATTERS.appeal.id);
      await actions.locator('[data-slot="judgment-ask-link"]').click();
      await contentReady(page);
      await expect(page).toHaveURL(new RegExp(`copilot\\?judgment=${judgmentId}`));
      await expect(page.locator('[data-slot="copilot-judgment-context"]')).toBeVisible();
      await expect(page.getByLabel(/Your question/)).not.toHaveValue('');
    } finally {
      await withSql(db.name, async (sql) => {
        await sql`delete from authority where draft_version_id in
          (select id from draft_version where draft_id = ${draftId})`;
        // draft_version is immutable: deleting the draft cascades to its versions.
        await sql`delete from draft where id = ${draftId}`;
        await sql`delete from research_note where matter_id = ${MATTERS.appeal.id}
          and title = 'Title withheld'`;
        await sql`delete from judgment_segment where judgment_id = ${judgmentId}`;
        await sql`delete from judgment where id = ${judgmentId}`;
      });
    }
  });
});
