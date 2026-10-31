// Seeds and locators for the drafting check, acknowledge and export journeys (#910). The e2e stack
// resolves citations against stored authorities only, so a draft citing `2023 INSC 999` gets a
// not-found result on `Check citations`. The draft is inserted
// straight into the worker database, as factcheck-helpers.ts does. Fictional data only.
import { createHash } from 'node:crypto';

import { expect, type Page } from '@playwright/test';
import postgres from 'postgres';

import { COURTS_WORKSPACE_ID } from '../../fixtures/courts-data.ts';
import { DRAFTING } from '../../fixtures/drafting-data.ts';
import { databaseUrl } from '../../support/db-reset.ts';

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const CITED_DRAFT = {
  id: uuid(0xe0010),
  title: 'Memo citing authority, W.P. 2/2099',
} as const;
export const CITED_STUDIO = `drafts/${CITED_DRAFT.id}`;

const BLOCKS = [
  { id: 'b1', type: 'heading', level: 1, text: 'Memo of appearance' },
  { id: 'b2', type: 'paragraph', text: 'Reliance is placed on 2023 INSC 999 for the point.' },
  { id: 'b3', type: 'paragraph', text: 'The same point is also made in 2023 INSC 123.' },
];

/** Insert a draft with citations that no stored authority resolves. */
export async function seedCitedDraft(database: string): Promise<void> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    const sha = createHash('sha256').update(JSON.stringify(BLOCKS)).digest('hex');
    await sql`
      insert into draft (id, workspace_id, template_id, title, status)
      values (${CITED_DRAFT.id}, ${COURTS_WORKSPACE_ID}, ${DRAFTING.template.id},
              ${CITED_DRAFT.title}, 'draft')`;
    await sql`
      insert into draft_version (workspace_id, draft_id, version_no, content, content_sha256)
      values (${COURTS_WORKSPACE_ID}, ${CITED_DRAFT.id}, 1, ${sql.json(BLOCKS)}, ${sha})`;
  } finally {
    await sql.end();
  }
}

/** The Citations panel in the studio's editor column. */
export const citationPanel = (page: Page) => page.locator('[data-slot="citation-panel"]');

/** Run `Check citations` and wait until the not-found result is listed. */
export async function checkCitations(page: Page): Promise<void> {
  const panel = citationPanel(page);
  const check = panel.getByRole('button', { name: 'Check citations' });
  // Cold first render: the studio can take well over a click's wait to hydrate, and a click before
  // hydration is lost. Wait for the panel, then retry the click until the result is listed.
  await panel.waitFor({ state: 'visible', timeout: 20_000 });
  await expect(async () => {
    if (await check.isEnabled()) await check.click({ timeout: 2_000 });
    await panel.getByText('Not found', { exact: true }).first().waitFor({ timeout: 3_000 });
  }).toPass({ timeout: 25_000 });
}
