// Help state (#94): a member's dismissed coachmarks persist per user and workspace, are idempotent,
// never leak to another member, and refuse non-members and malformed keys.
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { schema } from '@causedeck/db';
import { describe, expect, it } from 'vitest';

import type { WorkspaceError } from '../../shared/errors.ts';
import { dismissCoachmark, listDismissedCoachmarks } from '../index.ts';

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  return promise.then(
    () => undefined,
    (e: unknown) => (e as WorkspaceError).code,
  );
}

describe('help state', () => {
  it('persists a dismissal once per user and workspace', async () => {
    await withTestDb(async (tx) => {
      const t = await seedTwoTenants(tx);
      await inWorkspace(tx, t.a.id, (s) => s.delete(schema.helpState));
      const actor = { userId: t.ua, workspaceId: t.a.id };
      expect(await listDismissedCoachmarks(tx, actor)).toEqual([]);
      await dismissCoachmark(tx, actor, { key: 'coachmark.inbox' });
      await dismissCoachmark(tx, actor, { key: 'coachmark.inbox' });
      await dismissCoachmark(tx, actor, { key: 'coachmark.today' });
      expect(await listDismissedCoachmarks(tx, actor)).toEqual([
        'coachmark.inbox',
        'coachmark.today',
      ]);
      // Another member's own list is theirs alone.
      expect(
        await listDismissedCoachmarks(tx, { userId: t.ub, workspaceId: t.b.id }),
      ).toEqual(['coachmark.today']);
    });
  });

  it('refuses malformed keys and non-members', async () => {
    await withTestDb(async (tx) => {
      const t = await seedTwoTenants(tx);
      const actor = { userId: t.ua, workspaceId: t.a.id };
      expect(await codeOf(dismissCoachmark(tx, actor, { key: 'Bad Key!' }))).toBe('VALIDATION');
      expect(await codeOf(dismissCoachmark(tx, actor, { key: '' }))).toBe('VALIDATION');
      expect(
        await codeOf(dismissCoachmark(tx, { userId: t.ub, workspaceId: t.a.id }, { key: 'x' })),
      ).toBe('NOT_FOUND');
    });
  });
});
