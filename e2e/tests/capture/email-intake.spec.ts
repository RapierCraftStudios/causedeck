// Email forward-in intake (#530): what the person sees when `email.intake` quarantines a message
// from a sender that is not on the allow-list: one Needs-you card titled "Unrecognised sender:
// review", with no recovery buttons that read the mail (nothing in it was parsed). The e2e stack has
// no job worker, so the spec seeds the quarantine capture with superuser SQL on the worker database,
// as the inbox spec does. The webhook, the parsers and the job are covered by the api, capture and
// core suites. Fictional data only.
import { randomUUID } from 'node:crypto';

import { expect, test } from '../../fixtures/index.ts';
import { WORKSPACE, WORKSPACE_ID, withSql } from '../lifecycle/helpers.ts';
import { shellReady } from '../shell/helpers.ts';

test.describe('email intake', () => {
  test('a quarantined message is one Needs-you card and nothing was read', async ({
    page,
    asUser,
    db,
  }) => {
    await withSql(db.name, async (sql) => {
      await sql`delete from capture where workspace_id = ${WORKSPACE_ID} and source_meta ->> 'e2eEmail' = '1'`;
      await sql`
        insert into capture (id, workspace_id, channel, status, mime, size_bytes, ai_blocked, source_meta)
        values (${randomUUID()}, ${WORKSPACE_ID}, 'email', 'needs_you', 'message/rfc822', 0, true,
          ${sql.json({ e2eEmail: '1', needsYouReason: 'unrecognised_sender' })})`;
    });
    await asUser('owner', { workspace: WORKSPACE, path: 'inbox' });
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
    await shellReady(page);

    const card = page.locator('[data-slot="unreadable-card"]');
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('heading', { name: 'Unrecognised sender: review' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Keep as attachment' })).toHaveCount(0);
  });
});
