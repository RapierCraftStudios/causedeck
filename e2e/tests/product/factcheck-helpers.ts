// Seeds and locators for the fact-check journeys (#917, part 5 of #170). The e2e stack has no AI or
// job worker, so only the rule pass (case numbers against the matter record) runs: a draft linked to
// the seeded appeal matter (W.P. 3001/2024 and W.A. 210/2025) is inserted straight into the worker
// database, as outward-drafts-helpers.ts does. Fictional data only.
import { createHash } from 'node:crypto';

import type { Page } from '@playwright/test';
import postgres from 'postgres';

import { COURTS_WORKSPACE_ID } from '../../fixtures/courts-data.ts';
import { DRAFTING } from '../../fixtures/drafting-data.ts';
import { MATTERS } from '../../fixtures/matters-data.ts';
import { databaseUrl } from '../../support/db-reset.ts';

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const FACT_DRAFT = { id: uuid(0xf0002), title: 'Fact-check memo, W.P. 3001/2024' } as const;
export const FACT_STUDIO = `drafts/${FACT_DRAFT.id}`;

/** The record says W.P. 3001/2024 and W.A. 210/2025; the draft is wrong on the first. */
export const MISMATCH_TEXT = 'The petition W.P. No. 3002 of 2024 is pending before this Court.';
export const RECORD_CASE = 'WP 3001/2024';
export const UNSUPPORTED_TEXT = 'An earlier Crl.A. No. 55 of 2023 was disposed of.';
export const MATCH_TEXT = 'The connected W.A. No. 210 of 2025 is listed.';
export const NEUTRAL_TEXT = 'The matter is listed for hearing.';
/** One appeal on record, a different number: a second mismatch. */
export const SECOND_MISMATCH_TEXT = 'The appeal W.A. No. 211 of 2025 is connected.';

const BLOCKS = [
  { id: 'b1', type: 'heading', level: 1, text: 'Memo of appearance' },
  { id: 'b2', type: 'paragraph', text: MISMATCH_TEXT },
  { id: 'b3', type: 'paragraph', text: UNSUPPORTED_TEXT },
  { id: 'b4', type: 'paragraph', text: MATCH_TEXT },
  { id: 'b5', type: 'paragraph', text: NEUTRAL_TEXT },
];

/** Insert a draft on the appeal matter with its first version; the studio checks it on open. */
export async function seedFactDraft(database: string): Promise<void> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    const content = JSON.stringify(BLOCKS);
    const sha = createHash('sha256').update(content).digest('hex');
    await sql`
      insert into draft (id, workspace_id, template_id, matter_id, title, status)
      values (${FACT_DRAFT.id}, ${COURTS_WORKSPACE_ID}, ${DRAFTING.template.id}, ${MATTERS.appeal.id},
              ${FACT_DRAFT.title}, 'draft')`;
    await sql`
      insert into draft_version (workspace_id, draft_id, version_no, content, content_sha256)
      values (${COURTS_WORKSPACE_ID}, ${FACT_DRAFT.id}, 1, ${sql.json(BLOCKS)}, ${sha})`;
  } finally {
    await sql.end();
  }
}

/** A paragraph's textarea in the studio editor. */
export const block = (page: Page, key: string) =>
  page.locator(`main textarea[data-block-key="${key}"]`);

/** Squiggles in the studio editor, optionally of one status. */
export const squiggles = (page: Page, status?: string) =>
  page.locator(
    status === undefined
      ? '[data-slot="fact-squiggle"]:not([data-status="match"])'
      : `[data-slot="fact-squiggle"][data-status="${status}"]`,
  );

/** The Facts panel visible beside the editor (1280 px and up). */
export const panel = (page: Page) => page.locator('aside [data-slot="fact-check-panel"]');
