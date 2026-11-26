// Copilot starter questions (#1194), CI only (post-deploy check `copilot-starter-answers`): the
// workspace copilot's starters are about bail and writs, the subjects of the demo matters, and each
// one gets a substantive answer, meaning at least one verified claim and no "no authority" state. The
// matter starter about the orders gets one cited from the order's own page text. The `e2e` seed
// profile has no corpus, so the spec seeds one masked judgment per starter (fictional) and removes
// them after. The answer model is the mock provider (deterministic, extractive).
import { createHash, randomUUID } from 'node:crypto';

import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/index.ts';
import { MATTERS, MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { e2eUser } from '../../fixtures/workspace.ts';
import { withSql } from '../lifecycle/helpers.ts';

/** One fictional passage per corpus starter, worded the way a judgment answers it. */
const PASSAGES = [
  {
    starter: /regular bail/,
    title: 'A (fictional) v. State',
    text: '14. When granting regular bail, courts weigh the gravity of the offence, the likelihood of the accused fleeing and the risk of tampering with witnesses.',
  },
  {
    starter: /anticipatory bail/,
    title: 'B (fictional) v. State',
    text: '9. Anticipatory bail is refused where custodial interrogation is needed or the accused is likely to abscond.',
  },
  {
    starter: /writ petition/,
    title: 'C (fictional) v. Union of India',
    text: '21. A High Court will hear a writ petition despite an alternative remedy when a fundamental right is violated or the order was passed without jurisdiction.',
  },
] as const;

const ORDER_DIRECTION =
  'The directions in this order: the respondent shall file its counter within four weeks.';

async function expectVerifiedAnswer(page: Page): Promise<void> {
  await expect(page.locator('[data-slot="copilot-answer"]').first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('[data-slot="copilot-no-authority"]')).toHaveCount(0);
  const open = page.locator('[data-slot="copilot-sources-open"]').first();
  if (await open.isVisible()) await open.click();
  await expect(page.locator('[data-slot="copilot-claim"]:visible').first()).toBeVisible();
}

// R3b is a post-deploy check: it runs only when the check sets E2E_POST_DEPLOY=1, not in the PR shards.
test.describe('copilot starter questions', () => {
  // eslint-disable-next-line no-process-env -- the post-deploy switch is set by the registered check.
  test.skip(process.env['E2E_POST_DEPLOY'] !== '1', 'post-deploy check (copilot-starter-answers)');

  test('each workspace and matter starter gets a verified answer', async ({
    page,
    asUser,
    db,
  }) => {
    const judgmentIds = PASSAGES.map(() => randomUUID());
    const documentId = randomUUID();
    await withSql(db.name, async (sql) => {
      await sql`
        insert into feature_flag (key, enabled, updated_by)
        values ('copilot.enabled', true, ${e2eUser('owner').id})
        on conflict (key) do update set enabled = true`;
      for (const [k, p] of PASSAGES.entries()) {
        const id = judgmentIds[k] ?? '';
        const sha256 = createHash('sha256').update(`e2e-copilot-starters:${id}`).digest('hex');
        const pages = [{ pageNo: 1, text: p.text }];
        const provenance = {
          url: `https://demo.causedeck.test/corpus/${id}`,
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
          values (${id}, 'demo.corpus', 'MHC', ${`2024:MHC:${String(9100 + k)}`}, '2024-03-04', ${sha256},
            ${sql.json(provenance)}, ${sql.json(pages)}, ${sql.json(pages)}, 1, 1, 1,
            ${p.title}, true, 'high_court')`;
        await sql`
          insert into judgment_segment (judgment_id, ordinal, role, page_from, page_to, text, court,
            court_level, judgment_year)
          values (${id}, 1, 'reasoning', 1, 1, ${p.text}, 'MHC', 'high_court', 2024)`;
      }
      const [matter] = await sql<{ workspace_id: string }[]>`
        select workspace_id::text from matter where id = ${MATTERS.appeal.id}`;
      const workspaceId = matter?.workspace_id ?? '';
      await sql`
        insert into document (id, workspace_id, matter_id, kind, storage_key, sha256, language)
        values (${documentId}, ${workspaceId}, ${MATTERS.appeal.id}, 'order',
          ${`ws/${workspaceId}/document/${documentId}`}, ${'d'.repeat(64)}, 'en')`;
      await sql`
        insert into document_page (workspace_id, document_id, page_no, text, text_source, lang)
        values (${workspaceId}, ${documentId}, 1, ${`ORDER\n\n1. ${ORDER_DIRECTION}`}, 'layer', 'en')`;
    });
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      for (const p of PASSAGES) {
        await asUser('owner', { workspace: MATTERS_WORKSPACE, path: 'copilot' });
        const starter = page.locator('[data-slot="copilot-suggestion"]').filter({
          hasText: p.starter,
        });
        await expect(starter).toHaveCount(1);
        await starter.click();
        await expectVerifiedAnswer(page);
      }
      await asUser('owner', {
        workspace: MATTERS_WORKSPACE,
        path: `matters/${MATTERS.appeal.id}/copilot`,
      });
      await page
        .locator('[data-slot="copilot-suggestion"]')
        .filter({ hasText: /directions do the orders/ })
        .click();
      await expectVerifiedAnswer(page);
    } finally {
      await withSql(db.name, async (sql) => {
        await sql`delete from document_page where document_id = ${documentId}`;
        await sql`delete from document where id = ${documentId}`;
        for (const id of judgmentIds) {
          await sql`delete from judgment_segment where judgment_id = ${id}`;
          await sql`delete from judgment where id = ${id}`;
        }
      });
    }
  });
});
