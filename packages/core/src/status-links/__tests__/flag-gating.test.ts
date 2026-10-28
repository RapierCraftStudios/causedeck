import { schema } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import {
  FeatureDisabledError,
  createStatusLink,
  extendStatusLink,
  listStatusLinks,
  prefillFromDraft,
  revokeStatusLink,
} from '../index.ts';
import { chamber, deps, inWs, input } from './helpers.ts';

const ID = '11111111-1111-4111-8111-111111111111';

describe('status_links.enabled flag', () => {
  it('rejects every service with FeatureDisabledError while off, writing nothing', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const off = deps(tx, { flagEnabled: () => Promise.resolve(false) });
      const calls = [
        () => createStatusLink(off, c.owner, input(c)),
        () => revokeStatusLink(off, c.owner, ID),
        () => extendStatusLink(off, c.owner, { linkId: ID, expiryDays: 10 }),
        () => listStatusLinks(off, c.owner, c.matterId),
        () => prefillFromDraft(off, c.owner, ID),
      ];
      for (const call of calls) await expect(call()).rejects.toBeInstanceOf(FeatureDisabledError);
      expect(await inWs(tx, c.workspaceId, (t) => t.select().from(schema.statusLink))).toHaveLength(0);
    });
  });

  it('is off by default on a fresh database (legal-gated)', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      await expect(
        createStatusLink({ db: tx }, c.owner, input(c)),
      ).rejects.toBeInstanceOf(FeatureDisabledError);
    });
  });
});
