// Drafting e2e fixture data (#829), shared by support/db-reset.ts (which seeds it into the template
// inside the workspace-scoped transaction of `seedCourtFixtures`) and the drafting specs. No
// Playwright or workspace-package imports: support/server-pool.ts loads db-reset.ts with plain
// `node --experimental-strip-types`. All fictional, all in `chennai-solo`.
import { createHash } from 'node:crypto';

import type postgres from 'postgres';

import { COURTS_WORKSPACE_ID } from './courts-data.ts';

export const DRAFTING_WORKSPACE = 'chennai-solo';

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const DRAFTING = {
  template: { id: uuid(0xe0001), code: 'e2e.memo', name: 'E2E memo of appearance' },
  draft: { id: uuid(0xe0002), title: 'Memo of appearance, W.P. 1/2099' },
  /** The title the create journey types into the picker. */
  created: 'E2E new draft',
} as const;

/** A block tree with a heading, a paragraph and a [[missing]] marker, valid for the editor. */
const BLOCKS = [
  { id: 'b1', type: 'heading', level: 1, text: 'Memo of appearance' },
  { id: 'b2', type: 'paragraph', text: 'Appearing for the petitioner: [[advocate_name]].' },
  { id: 'b3', type: 'paragraph', text: 'The matter is listed for hearing.' },
];

/** The fixture template, draft and its first version, before the first seed of the matters. */
export async function seedDraftingFixtures(tx: postgres.TransactionSql): Promise<void> {
  const ws = COURTS_WORKSPACE_ID;
  const content = JSON.stringify(BLOCKS);
  const sha = createHash('sha256').update(content).digest('hex');
  await tx`
    insert into template (id, workspace_id, code, name, kind, court_preset, blocks, locale, version,
      enabled)
    values (${DRAFTING.template.id}, ${ws}, ${DRAFTING.template.code}, ${DRAFTING.template.name},
            'memo', 'madras_hc', ${tx.json(BLOCKS)}, 'en', 1, true)`;
  await tx`
    insert into draft (id, workspace_id, template_id, title, status)
    values (${DRAFTING.draft.id}, ${ws}, ${DRAFTING.template.id}, ${DRAFTING.draft.title}, 'draft')`;
  await tx`
    insert into draft_version (workspace_id, draft_id, version_no, content, content_sha256)
    values (${ws}, ${DRAFTING.draft.id}, 1, ${tx.json(BLOCKS)}, ${sha})`;
}
