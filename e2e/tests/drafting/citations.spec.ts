// Drafting citations journey (#1137, part 5 of #1117), CI only (post-deploy check
// `drafting-citations-journey`): with one masked demo judgment seeded in the corpus and a draft citing
// it correctly (at its page 2), citing a fabricated judgment and citing a paragraph it does not have,
// `Check citations` shows the three states: Verified with a corpus link at `#page=2`, Not found with
// the unresolved reason, and Unknown with the paragraph-or-page reason. The export stays blocked until
// the unverified citations are acknowledged. Needs the corpus resolver as the default and the server
// gate over every non-verified citation (#1136). Fictional data only; the rows are removed after.
import { createHash, randomUUID } from 'node:crypto';

import { COURTS_WORKSPACE_ID } from '../../fixtures/courts-data.ts';
import { DRAFTING, DRAFTING_WORKSPACE } from '../../fixtures/drafting-data.ts';
import { expect, test } from '../../fixtures/index.ts';
import { withSql } from '../lifecycle/helpers.ts';
import { contentReady } from '../shell/helpers.ts';

const GOOD = '2024 INSC 501';
const FABRICATED = '2024 INSC 999';
const CITED_PAGE = 2;

const BLOCKS = [
  { id: 'b1', type: 'heading', level: 1, text: 'Written submissions' },
  {
    id: 'b2',
    type: 'paragraph',
    text: `Bail was granted in ${GOOD}, at p. ${String(CITED_PAGE)}.`,
  },
  { id: 'b3', type: 'paragraph', text: `The same was held in ${FABRICATED}.` },
  { id: 'b4', type: 'paragraph', text: `Liberty was reserved in ${GOOD}, para 40.` },
];

const UNVERIFIED = /citations? (is|are) not verified\./;

test.describe('drafting citations', () => {
  test('shows verified, not found and unknown with reasons and a corpus link; export waits for the acknowledgement', async ({
    page,
    asUser,
    db,
  }) => {
    const judgmentId = randomUUID();
    const draftId = randomUUID();
    const sha256 = createHash('sha256')
      .update(`e2e-drafting-citations:${judgmentId}`)
      .digest('hex');
    const sourceUrl = `https://demo.causedeck.test/corpus/${judgmentId}`;
    await withSql(db.name, async (sql) => {
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
          provenance, page_text, redaction_version, case_title, title_masked, court_level)
        values (${judgmentId}, 'demo.corpus', 'SC', ${GOOD}, '2024-03-04', ${sha256},
          ${sql.json(provenance)},
          ${sql.json([
            { pageNo: 1, text: '1. The appellant seeks bail.\n\n2. The facts are not in dispute.' },
            { pageNo: 2, text: '3. Bail is granted on conditions.\n\n4. Liberty is reserved.' },
          ])},
          1, 'X (fictional) v. State', true, 'supreme_court')`;
      const content = JSON.stringify(BLOCKS);
      await sql`
        insert into draft (id, workspace_id, template_id, title, status)
        values (${draftId}, ${COURTS_WORKSPACE_ID}, ${DRAFTING.template.id},
                'Submissions citing the corpus, W.P. 3/2099', 'draft')`;
      await sql`
        insert into draft_version (workspace_id, draft_id, version_no, content, content_sha256)
        values (${COURTS_WORKSPACE_ID}, ${draftId}, 1, ${sql.json(BLOCKS)},
                ${createHash('sha256').update(content).digest('hex')})`;
    });
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await asUser('owner', { workspace: DRAFTING_WORKSPACE, path: `drafts/${draftId}` });
      await contentReady(page);
      const panel = page.locator('[data-slot="citation-panel"]');
      const check = panel.getByRole('button', { name: 'Check citations' });
      await panel.waitFor({ state: 'visible', timeout: 20_000 });
      // A click before hydration is lost: retry until the results are listed.
      await expect(async () => {
        if (await check.isEnabled()) await check.click({ timeout: 2_000 });
        await panel.getByText('Not found', { exact: true }).first().waitFor({ timeout: 3_000 });
      }).toPass({ timeout: 25_000 });

      const item = (raw: RegExp) => panel.locator('li[data-citation-id]').filter({ hasText: raw });
      const good = item(/at p\. 2/);
      await expect(good.getByText('Verified', { exact: true })).toBeVisible();
      await expect(good.locator('[data-slot="citation-reason"]')).toHaveCount(0);
      await expect(good.getByRole('link', { name: 'Open source' })).toHaveAttribute(
        'href',
        `${sourceUrl}#page=${String(CITED_PAGE)}`,
      );

      const fabricated = item(/INSC 999/);
      await expect(fabricated.getByText('Not found', { exact: true })).toBeVisible();
      await expect(fabricated.locator('[data-slot="citation-reason"]')).toHaveText(
        'Not found in the corpus or any source.',
      );

      const wrong = item(/para 40/);
      await expect(wrong.getByText('Unknown', { exact: true })).toBeVisible();
      await expect(wrong.locator('[data-slot="citation-reason"]')).toHaveText(
        'The cited paragraph or page is not in the judgment.',
      );

      await expect(panel.getByRole('status')).toContainText('2 citations are not verified');

      await page.getByRole('button', { name: 'Export', exact: true }).click();
      const exportDialog = page.locator('[data-slot="export-dialog"]');
      await expect(exportDialog.getByText(UNVERIFIED)).toBeVisible();
      await expect(
        exportDialog.getByRole('button', { name: 'Export', exact: true }),
      ).toBeDisabled();
      await exportDialog.getByRole('button', { name: 'Acknowledge', exact: true }).click();
      const ack = page.locator('[data-slot="ack-dialog"]');
      await ack.getByLabel('I have verified these authorities myself').check();
      await ack.getByRole('button', { name: 'Confirm' }).click();
      await expect(ack).toBeHidden();
      await expect(panel.getByText('Acknowledged', { exact: true })).toHaveCount(2);

      await page.getByRole('button', { name: 'Export', exact: true }).click();
      const after = page.locator('[data-slot="export-dialog"]');
      await expect(after.getByText(UNVERIFIED)).toHaveCount(0);
      await expect(after.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
    } finally {
      await withSql(db.name, async (sql) => {
        await sql`delete from authority where draft_version_id in
          (select id from draft_version where draft_id = ${draftId})`;
        await sql`delete from draft_version where draft_id = ${draftId}`;
        await sql`delete from draft where id = ${draftId}`;
        await sql`delete from judgment where id = ${judgmentId}`;
      });
    }
  });
});
