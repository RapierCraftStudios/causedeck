import { createHash, randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { findContributedOrders } from './index.ts';

const NOW = new Date('2026-10-21T04:00:00.000Z');

async function source(tx: Transaction) {
  const id = `corpus.${randomUUID().replaceAll('-', '')}`;
  await tx.insert(schema.source).values({
    id,
    kind: 'court',
    baseUrl: `urn:corpus:${id}`,
    owner: 'corpus',
    termsStatus: 'cleared',
    counselStatus: 'cleared',
    clearedAt: NOW,
    retentionDays: 10,
  });
  return id;
}

async function copy(
  tx: Transaction,
  sourceId: string,
  over: Partial<typeof schema.contributedDocument.$inferInsert>,
) {
  const content = over.content === undefined ? `order text ${randomUUID()}` : over.content;
  await tx.insert(schema.contributedDocument).values({
    sourceId,
    kind: 'order',
    content,
    sha256: createHash('sha256')
      .update(content ?? randomUUID())
      .digest('hex'),
    retentionUntil: new Date(NOW.getTime() + 86_400_000),
    ...over,
  });
}

describe('findContributedOrders', () => {
  it('returns live order copies only, with no contributor field', async () => {
    await withTestDb(async (tx) => {
      const sourceId = await source(tx);
      await copy(tx, sourceId, { content: 'live order' });
      await copy(tx, sourceId, { kind: 'cause_list', content: 'a cause list' });
      await copy(tx, sourceId, { content: null, withdrawnAt: NOW });
      await copy(tx, sourceId, { retentionUntil: new Date(NOW.getTime() - 1) });
      await copy(tx, await source(tx), { content: 'another source' });

      const found = await findContributedOrders(tx, { sourceId, now: NOW });
      expect(found.map((c) => c.content)).toEqual(['live order']);
      expect(found[0]?.kind).toBe('order');
      expect(Object.keys(found[0] ?? {}).sort()).toEqual(
        [
          'content',
          'contributedAt',
          'forumLabel',
          'id',
          'kind',
          'listingDate',
          'provenance',
          'sourceId',
        ].sort(),
      );
    });
  });
});
