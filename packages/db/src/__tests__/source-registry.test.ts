// The source registry table (#478, D-048): court and notice sources cannot hold the captcha tier,
// and the 0065 backfill gave every access_mode_registry adapter an uncleared court source while
// leaving access_mode_registry itself intact.
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { source } from '../schema/source-registry.ts';
import { withTestDb } from '../testing/index.ts';

const base = { baseUrl: 'https://x.example.test', owner: 'o' };

describe('source', () => {
  it.each(['court', 'notice'] as const)('rejects %s + captcha with the CHECK', async (kind) => {
    await withTestDb(async (tx) => {
      const error: unknown = await tx
        .transaction((sp) =>
          sp.insert(source).values({ ...base, id: `t.${kind}`, kind, maxTier: 'captcha' }),
        )
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      const cause = ((error as { cause?: unknown }).cause ?? error) as { constraint_name?: string };
      expect(cause.constraint_name).toBe('source_no_captcha_chk');
    });
  });

  it('accepts a news source on the captcha tier', async () => {
    await withTestDb(async (tx) => {
      await tx.insert(source).values({ ...base, id: 't.news', kind: 'news', maxTier: 'captcha' });
    });
  });

  it('backfills one uncleared court source per access_mode_registry adapter', async () => {
    await withTestDb(async (tx) => {
      const missing = await tx.execute(sql`
        select distinct r.adapter_id from access_mode_registry r
        left join source s on s.id = r.adapter_id
        where s.id is null or s.kind <> 'court'`);
      expect(missing.length).toBe(0);
      const cleared = await tx.execute(sql`
        select id from source where kind = 'court' and (cleared_at is not null or terms_status <> 'pending')
          and id in (select adapter_id from access_mode_registry)`);
      expect(cleared.length).toBe(0);
    });
  });
});
