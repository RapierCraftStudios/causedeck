// Scratch visual check for #1136 (not committed): a draft with a not-found neutral citation and an
// `unknown` reporter citation, at 390 px and 1440 px, before and after acknowledging.
import { createHash } from 'node:crypto';

import postgres from 'postgres';

import { COURTS_WORKSPACE_ID } from '../../../fixtures/courts-data.ts';
import { DRAFTING, DRAFTING_WORKSPACE } from '../../../fixtures/drafting-data.ts';
import { expect, test } from '../../../fixtures/index.ts';
import { databaseUrl } from '../../../support/db-reset.ts';
import { contentReady } from '../../shell/helpers.ts';
import { citationPanel } from '../../product/drafting-helpers.ts';

const ID = '00000000-0000-4000-8000-0000000e1136';
const BLOCKS = [
  { id: 'b1', type: 'heading', level: 1, text: 'Memo of appearance' },
  { id: 'b2', type: 'paragraph', text: 'Reliance is placed on 2023 INSC 999 for the point.' },
  { id: 'b3', type: 'paragraph', text: 'The same point is made in (2019) 5 SCC 123.' },
];
const OUT = process.env.SHOT_DIR ?? 'test-results/1136';
const LABEL = process.env.SHOT_LABEL ?? 'after';

async function seed(database: string): Promise<void> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    const sha = createHash('sha256').update(JSON.stringify(BLOCKS)).digest('hex');
    await sql`insert into draft (id, workspace_id, template_id, title, status)
      values (${ID}, ${COURTS_WORKSPACE_ID}, ${DRAFTING.template.id}, 'Memo citing authority', 'draft')`;
    await sql`insert into draft_version (workspace_id, draft_id, version_no, content, content_sha256)
      values (${COURTS_WORKSPACE_ID}, ${ID}, 1, ${sql.json(BLOCKS)}, ${sha})`;
  } finally {
    await sql.end();
  }
}

for (const width of [390, 1440]) {
  test(`citations ${width}`, async ({ page, asUser, db }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await seed(db.name);
    await asUser('owner', { workspace: DRAFTING_WORKSPACE, path: `drafts/${ID}` });
    await contentReady(page);
    const panel = citationPanel(page);
    const check = panel.getByRole('button', { name: 'Check citations' });
    await panel.waitFor({ state: 'visible', timeout: 30_000 });
    await expect(async () => {
      if (await check.isEnabled()) await check.click({ timeout: 2_000 });
      await panel.getByText('Not found', { exact: true }).first().waitFor({ timeout: 3_000 });
    }).toPass({ timeout: 40_000 });
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/${LABEL}-${width}-checked.png`, fullPage: true });
    const ack = panel.getByRole('button', { name: 'Acknowledge not-found citations' });
    if ((await ack.count()) === 0) {
      console.log(`SHOT ${width}: no acknowledge button`);
      return;
    }
    await ack.click();
    const dialog = page.locator('[data-slot="ack-dialog"]');
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: `${OUT}/${LABEL}-${width}-dialog.png` });
    const reason = dialog.getByRole('textbox');
    if ((await reason.count()) > 0) await reason.first().fill('Verified both authorities in the reporter myself.');
    await dialog.getByLabel('I have verified these authorities myself').check();
    await dialog.getByRole('button', { name: /Confirm/ }).click();
    await expect(panel.getByText('Acknowledged', { exact: true }).first()).toBeVisible();
    console.log(`SHOT ${width}: acknowledged=${await panel.getByText('Acknowledged', { exact: true }).count()}`);
    await page.screenshot({ path: `${OUT}/${LABEL}-${width}-acknowledged.png`, fullPage: true });
  });
}
