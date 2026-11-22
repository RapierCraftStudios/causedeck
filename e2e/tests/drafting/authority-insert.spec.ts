// Authority insert journey (#1144, slice 3 of #1118), CI only (post-deploy check
// `drafting-authority-insert-journey`): with `copilot.enabled` on, one masked judgment in the corpus
// (segment searchable by text) and a draft on the matter, the lawyer asks the matter copilot, inserts
// the verified judgment claim into the draft ("Insert into draft"), opens the draft, runs the citation
// check (the inserted authority is Verified) and the export is open. Editing the inserted citation into
// one the corpus does not have makes it Not found and the export is blocked again. The answer model is
// the mock provider (deterministic, extractive). Fictional data only; the rows are removed after.
import { createHash, randomUUID } from 'node:crypto';

import { COURTS_WORKSPACE_ID } from '../../fixtures/courts-data.ts';
import { DRAFTING, DRAFTING_WORKSPACE } from '../../fixtures/drafting-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { MATTERS } from '../../fixtures/matters-data.ts';
import { e2eUser } from '../../fixtures/workspace.ts';
import { withSql } from '../lifecycle/helpers.ts';
import { contentReady } from '../shell/helpers.ts';

const CITATION = '2024 INSC 502';
const FABRICATED = '2024 INSC 998';
const PARAGRAPH =
  '12. No written consent was taken from the patient before the hysterectomy was performed.';
const BLOCKS = [
  { id: 'h1', type: 'heading', level: 1, text: 'Written submissions on consent' },
  { id: 'p1', type: 'paragraph', text: 'The plaintiff never gave written consent to surgery.' },
];

test.describe('drafting authority insert', () => {
  test('inserts a verified copilot claim into a draft; checks verify it and export opens; a fabricated edit blocks export', async ({
    page,
    asUser,
    db,
  }) => {
    const judgmentId = randomUUID();
    const draftId = randomUUID();
    const sha256 = createHash('sha256').update(`e2e-authority-insert:${judgmentId}`).digest('hex');
    const sourceUrl = `https://demo.causedeck.test/corpus/${judgmentId}`;
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
        url: sourceUrl,
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
          ${sql.json(provenance)}, ${sql.json(pages)}, ${sql.json(pages)}, 1, 1, 1,
          'P (fictional) v. City Nursing Home', true, 'supreme_court')`;
      await sql`
        insert into judgment_segment (judgment_id, ordinal, role, page_from, page_to, text, court,
          court_level, judgment_year)
        values (${judgmentId}, 1, 'facts', 2, 2, ${PARAGRAPH}, 'SC', 'supreme_court', 2024)`;
      await sql`
        insert into draft (id, workspace_id, template_id, matter_id, title, status)
        values (${draftId}, ${COURTS_WORKSPACE_ID}, ${DRAFTING.template.id}, ${MATTERS.appeal.id},
                'Consent submissions (fictional)', 'draft')`;
      await sql`
        insert into draft_version (workspace_id, draft_id, version_no, content, content_sha256)
        values (${COURTS_WORKSPACE_ID}, ${draftId}, 1, ${sql.json(BLOCKS)},
                ${createHash('sha256').update(JSON.stringify(BLOCKS)).digest('hex')})`;
    });
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await asUser('owner', {
        workspace: DRAFTING_WORKSPACE,
        path: `matters/${MATTERS.appeal.id}/copilot`,
      });
      await contentReady(page);
      await page.getByLabel(/Your question/).fill('Was written consent taken before hysterectomy?');
      await page.getByRole('button', { name: 'Ask' }).click();

      // The verified judgment claim carries "Insert into draft"; the server re-verifies the ref.
      const claim = page
        .locator('[data-slot="copilot-claim"]')
        .filter({ hasText: 'No written consent was taken' })
        .first();
      await expect(claim).toBeVisible({ timeout: 30_000 });
      await claim.getByRole('button', { name: 'Insert into draft' }).click();
      await claim.getByLabel('Draft').selectOption({ label: 'Consent submissions (fictional)' });
      await claim.getByLabel('After').selectOption('p1');
      await claim.getByRole('button', { name: 'Insert', exact: true }).click();
      const inserted = claim.locator('[data-slot="copilot-inserted"]');
      await expect(inserted).toContainText('Inserted into the draft.');

      // In the draft, the inserted authority is checked against the corpus: Verified, export open.
      await inserted.getByRole('link', { name: 'Open draft' }).click();
      await contentReady(page);
      await expect(page.locator('textarea').filter({ hasText: CITATION })).toHaveCount(1);
      const panel = page.locator('[data-slot="citation-panel"]');
      const check = panel.getByRole('button', { name: 'Check citations' });
      await panel.waitFor({ state: 'visible', timeout: 20_000 });
      const item = (raw: RegExp) => panel.locator('li[data-citation-id]').filter({ hasText: raw });
      await expect(async () => {
        if (await check.isEnabled()) await check.click({ timeout: 2_000 });
        await item(/INSC 502/)
          .getByText('Verified', { exact: true })
          .waitFor({ timeout: 3_000 });
      }).toPass({ timeout: 25_000 });
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      const exportDialog = page.locator('[data-slot="export-dialog"]');
      await expect(exportDialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
      await page.keyboard.press('Escape');

      // A fabricated edit of the inserted citation is Not found, and the export is blocked.
      const field = page.locator('textarea').filter({ hasText: CITATION }).first();
      const text = await field.inputValue();
      await field.fill(text.replace(CITATION, FABRICATED));
      await page.getByRole('button', { name: 'Save', exact: true }).first().click();
      await expect(page.getByText('Saved').first()).toBeVisible({ timeout: 15_000 });
      await expect(async () => {
        if (await check.isEnabled()) await check.click({ timeout: 2_000 });
        await item(/INSC 998/)
          .getByText('Not found', { exact: true })
          .waitFor({ timeout: 3_000 });
      }).toPass({ timeout: 25_000 });
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      const blocked = page.locator('[data-slot="export-dialog"]');
      await expect(blocked.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
    } finally {
      await withSql(db.name, async (sql) => {
        await sql`delete from authority where draft_version_id in
          (select id from draft_version where draft_id = ${draftId})`;
        await sql`delete from draft_version where draft_id = ${draftId}`;
        await sql`delete from draft where id = ${draftId}`;
        await sql`delete from judgment_segment where judgment_id = ${judgmentId}`;
        await sql`delete from judgment where id = ${judgmentId}`;
      });
    }
  });
});
